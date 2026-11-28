import * as cdk from 'aws-cdk-lib';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

export interface AsyncAgentWorkflowApiProps {
    /** 環境 */
    envName: string;
    removalPolicy: cdk.RemovalPolicy;

    /** BedrockのモデルID */
    bedrockModelId: string;
}

export class AsyncAgentWorkflowApiConstruct extends Construct {
    public readonly stateMachine: sfn.StateMachine;
    public readonly jobTable: dynamodb.Table;

    constructor(scope: Construct, id: string, props: AsyncAgentWorkflowApiProps) {
        super(scope, id);

        cdk.Tags.of(this).add('AppRole', 'AsyncAgentWorkflowAI-Backend');
        const { envName, removalPolicy, bedrockModelId } = props;

        // ============================================
        // DynamoDBテーブルの作成（TTL付き）
        // ============================================ 
        this.jobTable = new dynamodb.Table(this, 'AsyncJobTable', {
            tableName: `${envName}-genai-async-jobs`,
            partitionKey: {
                name: 'jobId',
                type: dynamodb.AttributeType.STRING,
            },
            timeToLiveAttribute: 'ttl',    // TTL属性を有効化
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: removalPolicy,
        });


        // クロスリージョン推論プロファイルのARNを組み立てて IModel として定義
        const isCrossRegion = /^(us|apac|jp|eu)\./.test(bedrockModelId);

        const stack = cdk.Stack.of(this);
        const modelArn = isCrossRegion
            ? `arn:aws:bedrock:${stack.region}:${stack.account}:inference-profile/${bedrockModelId}`
            : `arn:aws:bedrock:${stack.region}::foundation-model/${bedrockModelId}`;

        const targetModel: bedrock.IModel = { modelArn };

        // =================================================================
        // Step 1: テーマに関する調査・要点の洗い出し
        // 入力例: { "topic": "サーバーレスアーキテクチャのメリット" }
        // =================================================================
        const researchTask = new tasks.BedrockInvokeModel(this, 'Step1_Research', {
            model: targetModel,
            body: sfn.TaskInput.fromObject({
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: 1000,
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                // sfn.JsonPath.format で入力JSONの $.topic をプロンプトに埋め込む
                                text: sfn.JsonPath.format(
                                    'あなたは優秀なリサーチャーです。次のテーマについて重要なポイントを3つ箇条書きで調査・整理してください。\nテーマ: {}',
                                    sfn.JsonPath.stringAt('$.topic')
                                ),
                            }
                        ]
                    },
                ],
            }),
            // Bedrockの応答JSONからテキスト部分だけを抽出し、$.researchResult に格納して次へ渡す
            resultSelector: {
                'text.$': '$.Body.content[0].text',
            },
            // 元の入力（$.topic）を消さずに、$.researchResult に結果を追加保存
            resultPath: '$.researchResult',
        });

        // スロットリング等のエラーに対する自動リトライ（指数バックオフ）
        researchTask.addRetry({
            errors: ['Bedrock.ThrottlingException', 'States.TaskFailed'],
            interval: cdk.Duration.seconds(5),
            maxAttempts: 3,
            backoffRate: 2.0,
        });

        // =================================================================
        // Step 2: Step 1の調査結果を受け取って構成案を作成
        // =================================================================
        const outlineTask = new tasks.BedrockInvokeModel(this, 'Step2_CreateOutline', {
            model: targetModel,
            body: sfn.TaskInput.fromObject({
                anthropic_version: 'bedrock-2023-05-31',
                max_tokens: 1500,
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                // Step 1 で保存した $.researchResult.text をプロンプトに埋め込む
                                text: sfn.JsonPath.format(
                                    '以下の調査結果をもとに、初心者向けの解説記事の構成案（見出し3つ）を作成してください。\n\n【調査結果】\n{}',
                                    sfn.JsonPath.stringAt('$.researchResult.text')
                                ),
                            },
                        ],
                    },
                ],
            }),

            resultSelector: {
                'text.$': '$.Body.content[0].text',
            },
            resultPath: '$.outlineResult',
        });

        outlineTask.addRetry({
            errors: ['Bedrock.ThrottlingException', 'States.TaskFailed'],
            interval: cdk.Duration.seconds(5),
            maxAttempts: 3,
            backoffRate: 2.0,
        });

        // =================================================================
        // Step 3: 生成結果を DynamoDB に直接保存（Lambda不要！）
        //  tasks.DynamoPutItemを使うとStep FunctionのIAMロールへdynamodb:PutItem
        //  権限が自動で付与される
        // =================================================================
        const saveToDynamoTask = new tasks.DynamoPutItem(this, 'Step3_SaveToDynamoDB', {
            table: this.jobTable,
            item: {
                jobId: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.jobId')),
                topic: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.topic')),
                status: tasks.DynamoAttributeValue.fromString('COMPLETED'),
                researchResult: tasks.DynamoAttributeValue.fromString(
                    sfn.JsonPath.stringAt('$.researchResult.text')
                ),
                outlineResult: tasks.DynamoAttributeValue.fromString(
                    sfn.JsonPath.stringAt('$.outlineResult.text')
                ),
                updatedAt: tasks.DynamoAttributeValue.fromString(
                    sfn.JsonPath.stringAt('$$.State.EnteredTime') // Step Functionsの組み込み変数から現在時刻(ISO8601)を取得
                ),
            },
        })

        // =================================================================
        // ワークフロー定義（Step 1 → Step 2 → Step 3 を直列に繋ぐ）
        // =================================================================

        // 先頭にPassステートを追加：SQSから届いた $[0].body（文字列）をJSONオブジェクトに変換する
        const parseSqsInput = new sfn.Pass(this, 'ParseSqsInput', {
            parameters: {
                'payload.$': 'States.StringToJson($[0].body)',
            },
            // payload の中身（{"topic": "..."}）をそのままルートの $ に展開する！
            outputPath: '$.payload',
        });

        const definition = parseSqsInput
            .next(researchTask)
            .next(outlineTask)
            .next(saveToDynamoTask);

        this.stateMachine = new sfn.StateMachine(this, 'AiAgentStateMachine', {
            stateMachineName: `${envName}-genai-async-agent`,
            definitionBody: sfn.DefinitionBody.fromChainable(definition),
            timeout: cdk.Duration.minutes(5),
        });

        // =================================================================
        // 3. クロスリージョン推論用のIAM権限を追加付与
        // （推論プロファイル自体 ＋ ルーティング先の各リージョンの基盤モデルの両方が必要）
        // =================================================================
        if (isCrossRegion) {
            const baseModelId = bedrockModelId.replace(/^(us|apac|jp|eu)\./, '');
            this.stateMachine.addToRolePolicy(
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: ['bedrock:InvokeModel'],
                    resources: [
                        modelArn,
                        `arn:aws:bedrock:*::foundation-model/${baseModelId}`,
                    ],
                })
            );
        }

    }
}

