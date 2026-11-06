import * as cdk from 'aws-cdk-lib';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { S3CloudFrontConstruct } from 'cdk-s3-cloudfront';
import { ServerlessAuthConstruct } from 'cdk-serverless-auth';
import { Construct } from 'constructs';
import * as path from 'path';
import { PositiveApiConstruct } from './features/positive-api';
import { HenshinApiConstruct } from './features/henshin-api';


export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ==========================================
    // 1. 共通基盤・不変リソースの定義
    // ==========================================
    // フロントエンド (S3 + CloudFront (OAC連携))
    const frontendHosting = new S3CloudFrontConstruct(this, 'FrontendHosting', {});
    const frontendUrl = `https://${frontendHosting.distribution.distributionDomainName}`;

    // 認証 (Cognito User Pool と API Gateway)
    const auth = new ServerlessAuthConstruct(this, 'ServerlessAuth', {
      allowedOrigins: [frontendUrl],   // 許可するオリジン
    });

    // S3へのフロントエンドビルド配信
    new s3deploy.BucketDeployment(this, 'DeployWithInvalidation', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../frontend/out'))],
      destinationBucket: frontendHosting.bucket,
      distribution: frontendHosting.distribution,   // デプロイ時にCloudFronのキャッシュを削除
      distributionPaths: ['/*'],
    });

    // =========================================================
    // 2.【機能追加ゾーン】思いついたクソアプリ機能をここに並べていく
    // =========================================================
    // アプリ1: ポジティブ決算 AI
    new PositiveApiConstruct(this, 'PositiveApi', {
      frontendUrl: frontendUrl,
      httpApi: auth.httpApi,
      jwtAuthorizer: auth.jwtAuthorizer,
    });

    // アプリ2：変身！ 紙芝居
    const HenshinApi =  new HenshinApiConstruct(this, 'HenshinApi', {
      frontendUrl: frontendUrl,
      userPoolId: auth.userPool.userPoolId,
      userPoolClientId: auth.userPoolClient.userPoolClientId,
    })
    
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

    // アプリ1用
    // Api Gatewayのエンドポイント
    new cdk.CfnOutput(this, 'HttpApiURL', {
        value: `${auth.httpApi.apiEndpoint}/${auth.stage.stageName}`,
        description: 'HTTP API Base URL',
    });

    // アプリ2用
    // Lambda関数URL (Lambda専用Cloudfrontドメイン名)
    new cdk.CfnOutput(this, 'HenshinLambdaUrl', {
        value: HenshinApi.lambdaApiUrl,
        description: 'Henshin Stream Lambda Function URL with CORS',
    });
  }
}
