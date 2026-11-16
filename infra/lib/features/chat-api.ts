import * as cdk from 'aws-cdk-lib';
import * as apiGwV2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apiGwV2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as apiGwV2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as path from 'path';

export interface ChatApiProps {
    /** 環境 */
    envName: string;
    removalPolicy: cdk.RemovalPolicy;
    /** BedrockのモデルID */
    bedrockModelId: string;
    /** CloudFrontのURL (CORS対策) */
    frontendUrl: string;
    /** API Gateway（HTTP API）*/
    httpApi: apiGwV2.HttpApi;
    /** HTTP API用のJWTオーソライザー */
    jwtAuthorizer: apiGwV2Authorizers.HttpJwtAuthorizer;
    /** JWT認証用 */
    userPoolId: string;
    userPoolClientId: string;
}

export class ChatApiConstruct extends Construct {

    public readonly lambdaApiUrl: string;

    constructor(scope: Construct, id: string, props: ChatApiProps) {
        super(scope, id);

        cdk.Tags.of(this).add('AppRole', 'ChatAI-BackendApi');
        const {
            envName,
            removalPolicy,
            frontendUrl,
            httpApi,
            jwtAuthorizer,
            userPoolId,
            userPoolClientId,
            bedrockModelId,
        } = props;

        // ============================================
        // DynamoDBテーブルの作成（GSIとTTL付き）
        // ============================================ 
        const chatTable = new dynamodb.Table(this, 'ChatHistoryTable', {
            tableName: `${envName}-chat-history-table`,
            // メインのキー（右側の「チャット履歴」の取得用
            partitionKey: {
                name: 'sessionId',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'timestamp',
                type: dynamodb.AttributeType.STRING,
            },
            // TTL（自動削除の設定）
            timeToLiveAttribute: 'expiresAt',

            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: removalPolicy,
        });

        // GSI（グローバルセカンダリーインデックス）の追加 左側の「セッション一覧」の取得用）
        chatTable.addGlobalSecondaryIndex({
            indexName: 'UserSessionsIndex',
            partitionKey: {
                name: 'userId',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'updatedAt',  // 更新しておくと新しい順に並べて表示しやすくなる
                type: dynamodb.AttributeType.STRING,
            },
            // projectionType は全ての属性を含める (INCLUDEにしてnonKeyAttributes: ['title']で絞ることで最適化可能)
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // ============================================================================
        // Lambda 作成: (Bedrock連携)
        // CDKが自動でTypeScriptをビルド＆バンドルしてくれます
        // TODO henshinApiとほぼ同じ。CloudFront + Lambda関数URL（OAC）は部品化できそう
        // ============================================================================
        const functionName = `${envName}-chat-api`

        // SSM Parameter StoreにBedrockのモデルIDを設定
        // text用
        const modelIdParam = new ssm.StringParameter(this, 'BedrockModelIdParameter', {
            parameterName: `/chat-ai/${envName}/bedrock-model-id`,
            stringValue: bedrockModelId,
            description: `Bedrock Model ID for ChatAI (${envName})`,
        });

        // ロググループを明示的に作成する
        const logGroup = new logs.LogGroup(this, 'ChatLogGroup', {
            logGroupName: `/aws/lambda/${functionName}`,
            removalPolicy: removalPolicy,
            retention: logs.RetentionDays.ONE_WEEK,
        });

        const chatLambda = new NodejsFunction(this, 'ChatStreamLambda', {
            functionName: functionName,
            runtime: lambda.Runtime.NODEJS_24_X,
            entry: path.join(__dirname, '../../../backend/chat/index.ts'),
            handler: 'handler',
            timeout: cdk.Duration.seconds(60),
            logGroup: logGroup,
            environment: {
                TABLE_NAME: chatTable.tableName,
                USER_POOL_ID: userPoolId,
                CLIENT_ID: userPoolClientId,
                FRONTEND_URL: frontendUrl,
                BEDROCK_PARAMETER_NAME: modelIdParam.parameterName,
            },
        });

        // 権限を付与する
        modelIdParam.grantRead(chatLambda);
        chatTable.grantReadWriteData(chatLambda);
        chatLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                'bedrock:InvokeModelWithResponseStream',
                'bedrock:InvokeModel',
            ],
            resources: ['*'], // 本番環境では特定のモデルARNに絞るとより安全
        }));

        // レスポンスストリーミング対応の関数URLを発行
        const functionUrl = chatLambda.addFunctionUrl({
            authType: lambda.FunctionUrlAuthType.AWS_IAM,   // CloudFrontとのOACのため
            invokeMode: lambda.InvokeMode.RESPONSE_STREAM,  // ストリーミングモードを有効化
        });

        // Lambda専用のCloudfrontディストリビューションを作成
        const lambdaDistribution = new cloudfront.Distribution(this, 'ChatDistribution', {
            comment: `Chat API Distribution (${envName})`,
            defaultBehavior: {
                origin: origins.FunctionUrlOrigin.withOriginAccessControl(functionUrl),       // OACの設定
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,      // HTTPS強制
                allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED, // ストリーミング用にキャッシュ無効化
                originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
                responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT,
            },
        });

        // 環境変数設定用
        this.lambdaApiUrl = `https://${lambdaDistribution.distributionDomainName}`;

        // ==================================================
        // Lambda 作成: (セッション一覧取得)
        // CDKが自動でTypeScriptをビルド＆バンドルしてくれます
        // ==================================================
        const functionSessions = `${envName}-chat-sessions-api`;

        // ロググループを明示的に作成する
        const logGroupSessions = new logs.LogGroup(this, 'ChatSessionsLogGroup', {
            logGroupName: `/aws/lambda/${functionSessions}`,
            removalPolicy: removalPolicy,
            retention: logs.RetentionDays.ONE_WEEK,
        });

        const sessionsLambda = new NodejsFunction(this, 'ChatSessionsLambda', {
            functionName: functionSessions,
            runtime: lambda.Runtime.NODEJS_24_X,
            entry: path.join(__dirname, '../../../backend/sessions/index.ts'),
            handler: 'handler',
            timeout: cdk.Duration.seconds(30),
            logGroup: logGroupSessions,
            environment: {
                TABLE_NAME: chatTable.tableName,
                FRONTEND_URL: frontendUrl,
            },
        });

        // ルートの設定
        httpApi.addRoutes({
            path: '/sessions',
            methods: [apiGwV2.HttpMethod.GET],
            integration: new apiGwV2Integrations.HttpLambdaIntegration(
                'SessionsIntegration',
                sessionsLambda,
            ),
            authorizer: jwtAuthorizer,
        });

        // 権限の付与
        chatTable.grantReadData(sessionsLambda);

        // ==================================================
        // Lambda 作成: (会話履歴取得)
        // CDKが自動でTypeScriptをビルド＆バンドルしてくれます
        // ==================================================
        const functionHistory = `${envName}-chat-history-api`;

        // ロググループを明示的に作成する
        const logGroupHistory = new logs.LogGroup(this, 'ChatHistoryLogGroup', {
            logGroupName: `/aws/lambda/${functionHistory}`,
            removalPolicy: removalPolicy,
            retention: logs.RetentionDays.ONE_WEEK,
        });

        const historyLambda = new NodejsFunction(this, 'ChatHistoryLambda', {
            functionName: functionHistory,
            runtime: lambda.Runtime.NODEJS_24_X,
            entry: path.join(__dirname, '../../../backend/history/index.ts'),
            handler: 'handler',
            timeout: cdk.Duration.seconds(30),
            logGroup: logGroupHistory,
            environment: {
                TABLE_NAME: chatTable.tableName,
                FRONTEND_URL: frontendUrl,
            },
        });

        // ルートの設定
        httpApi.addRoutes({
            path: '/history',
            methods: [apiGwV2.HttpMethod.GET],
            integration: new apiGwV2Integrations.HttpLambdaIntegration(
                'HistoryIntegration',
                historyLambda,
            ),
            authorizer: jwtAuthorizer,
        });

        // 権限の付与
        chatTable.grantReadData(historyLambda);

        // ==================================================
        // Lambda 作成: (セッション削除)
        // CDKが自動でTypeScriptをビルド＆バンドルしてくれます
        // ==================================================
        const functionDeleteSession = `${envName}-chat-delete-session-api`;

        // ロググループを明示的に作成する
        const logGroupDeleteSession = new logs.LogGroup(this, 'ChatDeleteSessionLogGroup', {
            logGroupName: `/aws/lambda/${functionDeleteSession}`,
            removalPolicy: removalPolicy,
            retention: logs.RetentionDays.ONE_WEEK,
        });

        const deleteSessionLambda = new NodejsFunction(this, 'ChatDeleteSessionLambda', {
            functionName: functionDeleteSession,
            runtime: lambda.Runtime.NODEJS_24_X,
            entry: path.join(__dirname, '../../../backend/delete-session/index.ts'),
            handler: 'handler',
            timeout: cdk.Duration.seconds(30),
            logGroup: logGroupDeleteSession,
            environment: {
                TABLE_NAME: chatTable.tableName,
                FRONTEND_URL: frontendUrl,
            },
        });

        // ルートの設定
        httpApi.addRoutes({
            path: '/delete',
            methods: [apiGwV2.HttpMethod.DELETE],
            integration: new apiGwV2Integrations.HttpLambdaIntegration(
                'DeleteSessionIntegration',
                deleteSessionLambda,
            ),
            authorizer: jwtAuthorizer,
        });

        // 権限の付与
        chatTable.grantReadWriteData(deleteSessionLambda);

    }
}

