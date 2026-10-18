import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2_integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';


export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ==========================================
    // 1. フロントエンド部分 (S3 + CloudFront)
    // ==========================================
    // 静的ファイル保存用S3バケットの作成
    const websiteBucket = new s3.Bucket(this, 'NextjsWebsiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,  // Public Access遮断
      removalPolicy: cdk.RemovalPolicy.DESTROY,           // 個人開発/検証用に削除しやすく  
      autoDeleteObjects: true,                            // スタック削除時に中身も削除
    })

    // CloudFrontディストリビューションの作成（S3とOACで連携）
    const distribution = new cloudfront.Distribution(this, 'NextjsDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(websiteBucket),     // OACの設定
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,   // HTTPS強制
      },
      defaultRootObject: 'index.html',
    });

    const frontendUrl = `https://${distribution.distributionDomainName}`;

    // ==========================================
    // 2. バックエンド部分 (DynamoDB)
    // ==========================================
    // DynamoDBの作成
    const table = new dynamodb.Table(this, 'AppTable', {
      partitionKey: { name: 'UserId_Month', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'TransactionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,        // オンデマンド
      removalPolicy: cdk.RemovalPolicy.DESTROY,                 // 個人開発/検証用に削除しやすく  
    })

    // ==========================================
    // 3. Lambdaレイヤーの作成
    // ==========================================
    const commonLayer = new lambda.LayerVersion(this, 'CommonLayer', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../../backend/layers/common_layer')),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: 'Shared libraries and modules for backend functions',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // 検証用
    });

    // =========================================================
    // 4. バックエンド部分 (Lambda-仕訳用: DynamoDB、Bedrock連携)
    // =========================================================
    const lambdaJournal = new lambda.Function(this, 'LambdaJournalFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'lambda_function.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../backend/lambda_journal')),
      timeout: cdk.Duration.seconds(30),
      layers: [commonLayer],
      environment: {
        TABLE_NAME: table.tableName,
        FRONTEND_URL: frontendUrl,
      },
    })

    // Bedrock呼び出しのIAMポリシーを定義
    const bedrockPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    });

    lambdaJournal.addToRolePolicy(bedrockPolicy);

    // DynamoDBの書き込み権限を付与
    table.grantWriteData(lambdaJournal);

    // ==============================================
    // 5. バックエンド部分 (Lambda 集計: DynamoDB連携)
    // ==============================================
    const lambdaSummary = new lambda.Function(this, 'LambdaSummaryFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'lambda_function.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../backend/lambda_summary')),
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: table.tableName,
        FRONTEND_URL: frontendUrl,
      },
    });

    // DynamoDBの読み込み権限を付与
    table.grantReadData(lambdaSummary);

    // ==========================================
    // 6. API Gatewayの作成 (HTTP API)
    // ==========================================
    const httpApi = new apigwv2.HttpApi(this, 'AppHttpApi', {
      apiName: 'Serverless App HTTP API',
      createDefaultStage: false,
      corsPreflight: {
        allowOrigins: [frontendUrl],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['*'],
      },
    });

    // 明示的にステージを作成し、スロットリング(レート・バースト制限)を適用
    const stage = new apigwv2.HttpStage(this, 'DefaultStage', {
      httpApi,
      stageName: 'prod',
      autoDeploy: true,
      throttle: {
        rateLimit: 10,
        burstLimit: 20,
      },
    })

    // ルートの設定 /journal (POST)
    httpApi.addRoutes({
      path: '/journal',
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2_integrations.HttpLambdaIntegration('JournalIntegration', lambdaJournal),
    });

    // ルートの設定 /summary (GET)
    httpApi.addRoutes({
      path: '/summary',
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2_integrations.HttpLambdaIntegration('SummaryIntegration', lambdaSummary),
    });

    // ==========================================
    // 7. S3へのフロントエンドビルド配信
    // ==========================================
    new s3deploy.BucketDeployment(this, 'DeployWithInvalidation', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../frontend/out'))],
      destinationBucket: websiteBucket,
      distribution: distribution,   // デプロイ時にCloudFronのキャッシュを削除
      distributionPaths: ['/*'],
    });

    // ==========================================
    // 8. 出力設定
    // ==========================================
    // CloudFrontのURL(DomainName)
    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'The URL of the Next.js website',
    })

    // Api Gatewayのエンドポイント
    new cdk.CfnOutput(this, 'HttpApiURL', {
      value: `${httpApi.apiEndpoint}/${stage.stageName}`,
      description: 'HTTP API Base URL',
    });

  }
}
