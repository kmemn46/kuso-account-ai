import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apiGwV2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpSqsIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as pipes from 'aws-cdk-lib/aws-pipes';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';
import * as path from 'path';

export interface AsyncQueuePipelineProps {
    /** 環境 */
    envName: string;
    removalPolicy: cdk.RemovalPolicy;

    /** CloudFrontのURL (CORS対策) */
    frontendUrl: string;
    /** API Gateway（HTTP API）*/
    httpApi: apigwv2.HttpApi;
    /** HTTP API用のJWTオーソライザー */
    jwtAuthorizer: apigwv2.IHttpRouteAuthorizer;
    /** Step Functions */
    stateMachine: sfn.IStateMachine;
    /** DynamoDB */
    jobTable: dynamodb.Table;
}

export class AsyncQueuePipelineConstruct extends Construct {
    public readonly queue: sqs.Queue;

    constructor(scope: Construct, id: string, props: AsyncQueuePipelineProps) {
        super(scope, id);

        cdk.Tags.of(this).add('AppRole', 'AsyncQueuePipeline-Backend');
        const {
            envName,
            removalPolicy,
            frontendUrl,
            httpApi,
            jwtAuthorizer,
            stateMachine,
            jobTable,
        } = props;

        const rootLockFile = path.join(__dirname, '../../../package-lock.json');

        // =================================================================
        // 1. デッドレターキュー（DLQ）とメインの SQS キューを作成
        // =================================================================
        const dlq = new sqs.Queue(this, 'AgentJobDlq', {
            queueName: `genai-agent-dlq-${envName}`,
            retentionPeriod: cdk.Duration.days(14),
        });

        this.queue = new sqs.Queue(this, 'AgentJobQueue', {
            queueName: `genai-agent-queue-${envName}`,
            // Step Functions のタイムアウト（5分）より少し長めに設定するのが鉄則
            visibilityTimeout: cdk.Duration.minutes(6), // ここで「1回の処理待ち時間 ＝ 6分」と指定している！「6分間」は他の人が触れないようにロックされる
            deadLetterQueue: {
                queue: dlq,
                maxReceiveCount: 3, // ここで「合計3回失敗したら DLQ に移動する」と指定している！
            },
        });

        // SQSキューのリソースポリシーで API Gateway からの送信を許可
        this.queue.addToResourcePolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                principals: [new iam.ServicePrincipal('apigateway.amazonaws.com')],
                actions: ['sqs:SendMessage'],
                resources: [this.queue.queueArn],
                conditions: {
                    ArnEquals: {
                        'aws:SourceArn': `arn:aws:execute-api:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:${httpApi.apiId}/*`,
                    },
                },
            })
        );

        // =================================================================
        // 2. HTTP API から直接 SQS へ送信する統合（Lambdaなし！）
        // =================================================================
        const sqsIntegration = new HttpSqsIntegration('SqsSendMessageIntegration', {
            queue: this.queue,
            subtype: apigwv2.HttpIntegrationSubtype.SQS_SEND_MESSAGE,
            parameterMapping: apigwv2.ParameterMapping.fromObject({
                QueueUrl: apigwv2.MappingValue.custom(this.queue.queueUrl),
                MessageBody: apigwv2.MappingValue.custom('$request.body'),
            }),
        });

        // 既存の HTTP API にルートを追加（JWT認証付き）
        httpApi.addRoutes({
            path: '/async-jobs',
            methods: [apigwv2.HttpMethod.POST],
            integration: sqsIntegration,
            authorizer: jwtAuthorizer,
        });

        // =================================================================
        // 3. EventBridge Pipes で SQS → Step Functions を直接接続（Lambdaなし！）
        // =================================================================
        const pipeRole = new iam.Role(this, 'EventBridgePipeRole', {
            assumedBy: new iam.ServicePrincipal('pipes.amazonaws.com'),
        });

        // Pipe に「SQSから読み取る権限」と「Step Functionsを起動する権限」を付与
        this.queue.grantConsumeMessages(pipeRole);
        stateMachine.grantStartExecution(pipeRole);

        new pipes.CfnPipe(this, 'SqsToSfnPipe', {
            name: `genai-sqs-to-sfn-${envName}`,
            roleArn: pipeRole.roleArn,
            source: this.queue.queueArn,
            sourceParameters: {
                sqsQueueParameters: {
                    batchSize: 1, // 1リクエストにつき1つのStep Functionsを実行
                },
            },
            target: stateMachine.stateMachineArn,
            targetParameters: {
                stepFunctionStateMachineParameters: {
                    // 非同期起動（FIRE_AND_FORGET）を指定
                    invocationType: 'FIRE_AND_FORGET',
                },
            },
        });

        // =================================================================
        // 4. 結果取得用の超軽量 Lambdaを作成
        // =================================================================
        const functionAsyncJob = `${envName}-get-asyncjob-api`;

        // ロググループを明示的に作成する
        const logGroupAsync = new logs.LogGroup(this, 'GetAsyncJobLogGroup', {
            logGroupName: `/aws/lambda/${functionAsyncJob}`,
            removalPolicy: removalPolicy,
            retention: logs.RetentionDays.ONE_WEEK,
        });

        const getJobLambda = new NodejsFunction(this, 'GetAsyncJobLambda', {
            functionName: functionAsyncJob,
            runtime: lambda.Runtime.NODEJS_24_X,
            entry: path.join(__dirname, '../../../backend/async-job/index.ts'),
            depsLockFilePath: rootLockFile,
            handler: 'handler',
            logGroup: logGroupAsync,
            environment: {
                TABLE_NAME: jobTable.tableName,
                FRONTEND_URL: frontendUrl,
            },
        });

        // 最小権限：読み取り権限（GetItem）だけを付与
        jobTable.grantReadData(getJobLambda);

        // HTTP API に GET ルートを追加（JWT認証付き）
        httpApi.addRoutes({
            path: '/async-jobs/{jobId}',
            methods: [apigwv2.HttpMethod.GET],
            integration: new apiGwV2Integrations.HttpLambdaIntegration(
                'GetAsyncJobIntegration',
                getJobLambda,
            ),
            authorizer: jwtAuthorizer,
        });
    }

}