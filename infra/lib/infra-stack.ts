import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2_integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { AiBackendConstruct } from 'cdk-ai-backend';
import { S3CloudFrontConstruct } from 'cdk-s3-cloudfront';
import { ServerlessAuthConstruct } from 'cdk-serverless-auth';
import { Construct } from 'constructs';
import * as path from 'path';


export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ==========================================
    // 1. フロントエンド部分 (S3 + CloudFront)
    // ==========================================
    // 共通S3 + Cloudfront (OAC) モジュール
    const frontendHosting = new S3CloudFrontConstruct(this, 'FrontendHosting', {});
    const frontendUrl = `https://${frontendHosting.distribution.distributionDomainName}`;

    // ==================================================================
    // 2. バックエンド部分 (Lambda 仕訳用、集計用: Bedrock、DynamoDB連携)
    // ==================================================================
    // 共通AIバックエンドモジュール
    const aiBackend = new AiBackendConstruct(this, 'AiBackend', {
      writeLambdaEntryPath: path.join(__dirname, '../../backend/lambda_journal'),
      readLambdaEntryPath: path.join(__dirname, '../../backend/lambda_summary'),
      layerEntryPath: path.join(__dirname, '../../backend/layers/common_layer'),
      frontendUrl: frontendUrl,
    });

    // ==================================================
    // 3. 認証API部分 (Cognito User Pool と API Gateway)
    // ==================================================
    // 共通認証・APIモジュール
    const auth = new ServerlessAuthConstruct(this, 'ServerlessAuth', {
      allowedOrigins: [frontendUrl],
    });
    
    // ルートの設定 /journal (POST)
    auth.httpApi.addRoutes({
      path: '/journal',
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2_integrations.HttpLambdaIntegration(
        'JournalIntegration',
        aiBackend.writeLambda
      ),
      authorizer: auth.jwtAuthorizer,  // Cognitoの認証
    });

    // ルートの設定 /summary (GET)
    auth.httpApi.addRoutes({
      path: '/summary',
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2_integrations.HttpLambdaIntegration(
        'SummaryIntegration',
        aiBackend.readLambda
      ),
      authorizer: auth.jwtAuthorizer, // Cognitoの認証
    });
    
    // ==========================================
    // 4. S3へのフロントエンドビルド配信
    // ==========================================
    new s3deploy.BucketDeployment(this, 'DeployWithInvalidation', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../frontend/out'))],
      destinationBucket: frontendHosting.bucket,
      distribution: frontendHosting.distribution,   // デプロイ時にCloudFronのキャッシュを削除
      distributionPaths: ['/*'],
    });
  
    // ==========================================
    // 3. 出力設定
    // ==========================================
    // CloudFrontのURL(DomainName)
    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: `https://${frontendHosting.distribution.distributionDomainName}`,
      description: 'The URL of the Next.js website',
    });

    // CognitoのユーザープールID
    new cdk.CfnOutput(this, 'UserPoolId', {
        value: auth.userPool.userPoolId,
        description: 'Cognito User Pool ID',
    });

    // CognitoのクライアントID
    new cdk.CfnOutput(this, 'UserPoolClientId', {
        value: auth.userPoolClient.userPoolClientId,
        description: 'Cognito User Pool Client ID',
    });

    // Api Gatewayのエンドポイント
    new cdk.CfnOutput(this, 'HttpApiURL', {
        value: `${auth.httpApi.apiEndpoint}/${auth.stage.stageName}`,
        description: 'HTTP API Base URL',
    });

  }
}
