import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface AiBackendProps {
    /** 環境 */
    envName: string;
    removalPolicy: cdk.RemovalPolicy;
    /** 書き込み・AI処理用Lambdaのソースコードのファイルパス */
    writeLambdaEntryPath: string;
    /** 読み込み用Lambdaのソースコードのファイルパス */
    readLambdaEntryPath: string;
    /** Lambdaレイヤーのソースコードのファイルパス（オプション） */
    layerEntryPath?: string;
    /** CloudFrontのURL (CORS対策) */
    frontendUrl: string;
    /** BedrockのモデルID */
    bedrockModelId: string;
}

export class AiBackendConstruct extends Construct {

    // 外部ファイルから参照できるように公開するプロパティ
    public readonly writeLambda: lambda.Function;
    public readonly readLambda: lambda.Function;

    constructor(scope: Construct, id: string, props: AiBackendProps) {
        super(scope, id);

        const {
            envName,
            removalPolicy,
            writeLambdaEntryPath,
            readLambdaEntryPath,
            layerEntryPath,
            frontendUrl,
            bedrockModelId,
        } = props;

        // ==========================================
        // 1. DynamoDBの作成
        // ==========================================
        const dataTable = new dynamodb.Table(this, 'AiDataTable', {
            tableName: `${envName}-positive-ai-dataTable`,
            partitionKey: { name: 'UserId_Month', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'TransactionId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,        // オンデマンド
            removalPolicy: removalPolicy,
        });

        // ==========================================
        // 2. Lambdaレイヤーの作成
        // ==========================================
        let layers: lambda.ILayerVersion[] = [];
        if (layerEntryPath) {
            const aiLayer = new lambda.LayerVersion(this, 'AiLayer', {
                layerVersionName: `${envName}-positive-ai-dependencies-layer`,
                code: lambda.Code.fromAsset(layerEntryPath),
                compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
                description: `Shared libraries and modules for backend functions (${envName})`,
                removalPolicy: cdk.RemovalPolicy.DESTROY,     // Lambdaレイヤーは削除
            });

            const powertoolsLayer = lambda.LayerVersion.fromLayerVersionArn(
                this,
                'PowertoolsLayer',
                `arn:aws:lambda:us-east-1:017000801446:layer:AWSLambdaPowertoolsPythonV3-python312-x86_64:42`
            );

            layers.push(aiLayer);
            layers.push(powertoolsLayer);
        }

        // =========================================================
        // 3. Lambda 仕訳用作成: (DynamoDB、Bedrock連携)
        // =========================================================
        // SSM Parameter StoreにBedrockのモデルIDを設定
        const modelIdParam = new ssm.StringParameter(this, 'BedrockModelIdParameter', {
            parameterName: `/positive-ai/${envName}/bedrock-model-id`,
            stringValue: bedrockModelId,
            description: `Bedrock Model ID for PositiveAI (${envName})`,
        });

        // ロググループを明示的に作成する
        const functionJournal = `${envName}-positive-ai-journal`;
        const logGroupJournal = new logs.LogGroup(this, 'PositiveJournalLogGroup', {
            logGroupName: `/aws/lambda/${functionJournal}`,
            removalPolicy: removalPolicy,
            retention: logs.RetentionDays.ONE_WEEK,
        });

        this.writeLambda = new lambda.Function(this, 'LambdaJournalFunction', {
            functionName: functionJournal,
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: 'lambda_journal.lambda_handler',
            code: lambda.Code.fromAsset(writeLambdaEntryPath),
            timeout: cdk.Duration.seconds(30),
            layers: layers,
            logGroup: logGroupJournal,
            environment: {
                TABLE_NAME: dataTable.tableName,
                FRONTEND_URL: frontendUrl,
                BEDROCK_PARAMETER_NAME: modelIdParam.parameterName,
            },
        });

        // ==============================================
        // 4. Lambda 集計用作成: (DynamoDB連携)
        // ==============================================
        // ロググループを明示的に作成する
        const functionSummary = `${envName}-positive-ai-summary`;
        const logGroupSummary = new logs.LogGroup(this, 'PositiveSummaryLogGroup', {
            logGroupName: `/aws/lambda/${functionSummary}`,
            removalPolicy: removalPolicy,
            retention: logs.RetentionDays.ONE_WEEK,
        });

        this.readLambda = new lambda.Function(this, 'LambdaSummaryFunction', {
            functionName: functionSummary,
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: 'lambda_summary.lambda_handler',
            code: lambda.Code.fromAsset(readLambdaEntryPath),
            timeout: cdk.Duration.seconds(30),
            logGroup: logGroupSummary,
            environment: {
                TABLE_NAME: dataTable.tableName,
                FRONTEND_URL: frontendUrl,
            },
        });

        // ==============================================
        // 5. 権限の割り当て
        // ==============================================
        // 書き込み用には、DynamoDBの書き込みと、Bedrockの呼び出し権限を付与
        dataTable.grantWriteData(this.writeLambda);
        modelIdParam.grantRead(this.writeLambda);

        // Bedrock呼び出しのIAMポリシーを定義
        const bedrockPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['bedrock:InvokeModel'],
            resources: ['*'],
        });
        this.writeLambda.addToRolePolicy(bedrockPolicy);

        // 読み込み用には、DynamoDBの読み込み権限を付与
        dataTable.grantReadData(this.readLambda);

    }


}