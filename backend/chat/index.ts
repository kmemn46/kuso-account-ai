import { getParameter } from '@aws-lambda-powertools/parameters/ssm';
import { BedrockRuntimeClient, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';

// AWS Lambdaのレスポンスストリーミング用グローバル定義
declare const awsLambda: {
    streamifyResponse: (
        handler: (event: APIGatewayProxyEventV2, responseStream: NodeJS.WritableStream, context: Context) => Promise<void>
    ) => any;
};

// パラメータ設定（環境変数などから取得）
const region = process.env.AWS_REGION || "us-east-1";
const userPoolId = process.env.USER_POOL_ID || 'us-east-1_xxxxxxxxx';
const clientId = process.env.CLIENT_ID || 'your-client-id';
const frontendUrl = process.env.FRONTEND_URL || '*';

const jwtVerifier = CognitoJwtVerifier.create({ userPoolId, tokenUse: 'access', clientId }); //JWTトークンバリデータの初期化
const bedrockClient = new BedrockRuntimeClient({ region });    // Bedrock Runtime クライアントの初期化
const dynamoClient = new DynamoDBClient({ region });           // DynamoDB クライアントの初期化
const docClient = DynamoDBDocumentClient.from(dynamoClient);   // DynamoDB クライアントのラッパー

const BEDROCK_PARAMETER_NAME = process.env.BEDROCK_PARAMETER_NAME || '';
const TABLE_NAME = process.env.TABLE_NAME || "";

export const handler = awslambda.streamifyResponse(
    async (event: APIGatewayProxyEventV2, responseStream: NodeJS.WritableStream, context: Context) => {

        // 共通のHeaders
        const corsHeaders = {
            "Access-Control-Allow-Origin": frontendUrl,
            "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
            "Access-Control-Allow-Headers": "Content-Type,X-User-Token,x-amz-content-sha256",
        };

        const httpMethod = event.requestContext?.http?.method || 'GET';

        // OPTIONリクエスト（プリフライトの処理）
        if (httpMethod === 'OPTIONS') {
            const httpResponseMetadata = {
                statusCode: 200,
                headers: corsHeaders,
            };
            const stream = awslambda.HttpResponseStream.from(responseStream as any, httpResponseMetadata);
            stream.write("");
            stream.end();
            return;
        }

        try {

            // JWTトークンを取得し aws-jwt-verify を使ってトークンを検証（無効な場合は例外がスローされます）
            const authHeader = event.headers?.['x-user-token'] || event.headers?.['X-User-Token'];
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                const unauthorizedMetadata = {
                    statusCode: 401,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                };
                const stream = awslambda.HttpResponseStream.from(responseStream as any, unauthorizedMetadata);
                stream.write(JSON.stringify({ error: "Unauthorized: Authorization header is missing or invalid" }));
                stream.end();
                return;
            }

            const token = authHeader.split(' ')[1];
            const payloadJwt = await jwtVerifier.verify(token);
            console.log("JWT検証成功！ユーザーID:", payloadJwt.sub);

            // リクエストパラメータの取得と検証
            const body = event.body ? JSON.parse(event.body) : {};
            const sessionId = body.sessionId;
            const userMessage = body.userMessage;
            const userId = payloadJwt.sub;

            if (!sessionId || !userMessage) {
                const unauthorizedMetadata = {
                    statusCode: 400,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                };
                const stream = awslambda.HttpResponseStream.from(responseStream as any, unauthorizedMetadata);
                stream.write(JSON.stringify({ error: "sessionId and message are required" }));
                stream.end();
                return;
            }

            // 認証成功＆データ準備完了のレスポンスヘッダー設定（ストリーミング用）
            const httpResponseMetadata = {
                statusCode: 200,
                headers: {
                    ...corsHeaders,
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                },
            };
            const stream = awslambda.HttpResponseStream.from(responseStream as any, httpResponseMetadata);

            // DynamoDBから過去の会話履歴を取得
            const queryResponse = await docClient.send(
                new QueryCommand({
                    TableName: TABLE_NAME,
                    KeyConditionExpression: "sessionId = :sessionId",
                    ExpressionAttributeValues: { ":sessionId": sessionId },
                    ScanIndexForward: false, // false にすると「新しい順（降順）」になる
                    Limit: 10,               // 最新の10件だけをダイレクトに取得！
                })
            );

            const items = queryResponse.Items || [];

            // メタデータを除外し、純粋なメッセージだけを抽出する
            const historyMessages = items
                .filter((item) => item.timestamp !== "METADATA")
                .map((item) => ({
                    role: item.role,
                    content: item.content,
                }));

            // 降順（新しい順）で取得しているため、Bedrockに渡すために「古い順（昇順）」にひっくり返す
            const chronologicalMessages = historyMessages.reverse();

            // 今回の新しいユーザーの質問を末尾に追加する
            chronologicalMessages.push({ role: "user", content: userMessage });

            // Converse API用のメッセージ形式に組み立てる
            const bedrockMessages = chronologicalMessages.map((msg) => ({
                role: msg.role,
                content: [{ text: msg.content }],
            }));

            // Converse API（ConverseStreamCommand）の設定
            // 自動キャッシュ付きでモデルIDを取得（取得後5分間はキャッシュを利用）
            const modelId = await getParameter(BEDROCK_PARAMETER_NAME, { maxAge: 300 });
            console.log(`Using Bedrock Model ID: ${modelId}`);

            const command = new ConverseStreamCommand({
                modelId: modelId,
                messages: bedrockMessages,
                // システムプロンプト（AIへの役割や指示）も共通の形式で指定可能
                // system: [
                //     {
                //         text: "あなたは親切で分かりやすいプログラミング講師です。初心者の方にも丁寧な日本語で回答してください。",
                //     },
                // ],
                inferenceConfig: {
                    maxTokens: 1000,
                    temperature: 0.7,
                },
            });

            const bedrockResponse = await bedrockClient.send(command);

            let fullAssistantMessage = "";

            if (bedrockResponse.stream) {
                for await (const chunk of bedrockResponse.stream) {
                    if (chunk.contentBlockDelta && chunk.contentBlockDelta.delta?.text) {
                        const chunkText = chunk.contentBlockDelta.delta.text;
                        fullAssistantMessage += chunkText;
                        const seeData = `data: ${JSON.stringify({ text: chunkText })}\n\n`;
                        stream.write(seeData); // フロントエンドへリアルタイムに
                    }
                }
            }

            // すべての書き込みが終わったらストリームを閉じる
            stream.write(`data: [DONE]\n\n`);
            stream.end();

            // ストリーミング完了後、DynamoDBに会話履歴と「セッションタイトル」を保存する
            const now = new Date();
            const timestamp = now.toISOString();
            const expiresAt = Math.floor(now.getTime() / 1000) + 30 * 24 * 60 * 60;

            // 最初のメッセージの先頭20文字をセッションタイトルとして切り出す
            const generatedTitle = userMessage.length > 20 ? userMessage.substring(0, 20) + "..." : userMessage;

            // 会話履歴からMETADATAを取得
            const metaItem = items.find((item) => item.timestamp === "METADATA");

            // セッションの基本情報（タイトルや最終更新日）を保存するメタデータ用レコード
            if (!metaItem) {
                await docClient.send(
                    new PutCommand({
                        TableName: TABLE_NAME,
                        Item: {
                            sessionId: sessionId,
                            timestamp: "METADATA", // セッションメタデータ用の固定キー
                            userId: userId,
                            title: generatedTitle,
                            updatedAt: timestamp,
                            expiresAt: expiresAt,
                        },
                    })
                );
            } else {
                await docClient.send(
                    new PutCommand({
                        TableName: TABLE_NAME,
                        Item: {
                            sessionId: sessionId,
                            timestamp: "METADATA",
                            userId: userId,
                            title: metaItem.title,
                            updatedAt: timestamp,
                            expiresAt: expiresAt,
                        },
                    })
                );
            }

            // ユーザーのメッセージ保存
            await docClient.send(
                new PutCommand({
                    TableName: TABLE_NAME,
                    Item: {
                        sessionId: sessionId,
                        timestamp: `${timestamp}#user`,
                        userId: userId,
                        role: "user",
                        content: userMessage,
                        updatedAt: timestamp,
                        expiresAt: expiresAt,
                    },
                })
            );

            // AIの回答保存
            await docClient.send(
                new PutCommand({
                    TableName: TABLE_NAME,
                    Item: {
                        sessionId: sessionId,
                        timestamp: `${new Date().toISOString()}#assistant`,
                        userId: userId,
                        role: "assistant",
                        content: fullAssistantMessage,
                        updatedAt: timestamp,
                        expiresAt: expiresAt,
                    },
                })
            );

        } catch (error: any) {
            console.error("Error in Converse API streaming Lambda:", error);
            const errorMetadata = {
                statusCode: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            };
            const stream = awslambda.HttpResponseStream.from(responseStream as any, errorMetadata);
            stream.write(JSON.stringify({ error: `Internal Server Error: ${error.message}` }));
            stream.end();
        }
    }
);
