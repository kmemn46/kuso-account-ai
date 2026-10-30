import * as apiGwV2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apiGwV2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as apiGwV2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { AiBackendConstruct } from 'cdk-ai-backend';
import { Construct } from "constructs";
import * as path from 'path';

export interface PositiveApiProps {
    /** CloudFrontのURL (CORS対策) */
    frontendUrl: string;
    /** API Gateway（HTTP API）*/
    httpApi: apiGwV2.HttpApi;
    /** HTTP API用のJWTオーソライザー */
    jwtAuthorizer: apiGwV2Authorizers.HttpJwtAuthorizer;
}

export class PositiveApiConstruct extends Construct {
    constructor(scope: Construct, id: string, props: PositiveApiProps) {
        super(scope, id);

    // =======================================================================
    // 1. バックエンド部分 (Lambda 仕訳用、集計用: Bedrock、DynamoDB作成と連携)
    // =======================================================================
    // 共通AIバックエンドモジュール
    const lamndaEntryPath = path.join(__dirname, '../../../backend/positive');
    const layerEntryPath = path.join(__dirname, '../../../backend/layers/common-layer');
    
    const aiBackend = new AiBackendConstruct(this, 'AiBackend', {
      writeLambdaEntryPath: lamndaEntryPath,
      readLambdaEntryPath: lamndaEntryPath,
      layerEntryPath: layerEntryPath,
      frontendUrl: props.frontendUrl, // CORS対策
    });

    // ルートの設定 /journal (POST)
    props.httpApi.addRoutes({
      path: '/journal',
      methods: [apiGwV2.HttpMethod.POST],
      integration: new apiGwV2Integrations.HttpLambdaIntegration(
        'JournalIntegration',
        aiBackend.writeLambda
      ),
      authorizer: props.jwtAuthorizer,  // Cognitoの認証
    });

    // ルートの設定 /summary (GET)
    props.httpApi.addRoutes({
      path: '/summary',
      methods: [apiGwV2.HttpMethod.GET],
      integration: new apiGwV2Integrations.HttpLambdaIntegration(
        'SummaryIntegration',
        aiBackend.readLambda
      ),
      authorizer: props.jwtAuthorizer, // Cognitoの認証
    });

    }
}