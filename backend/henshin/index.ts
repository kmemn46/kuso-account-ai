import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelWithResponseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { APIGatewayProxyResultV2 } from 'aws-lambda';

// AWS Lambdaのレスポンスストリーミング用グローバル定義
declare const awsLambda: {
    streamifyResponse: (
        handler: (event: any, responseStream: NodeJS.WritableStream, context: Context) => Promise<void>
    ) => any;
}

// ==========================================
// パラメータ設定（環境変数などから取得）
// ==========================================
const USER_POOL_ID = process.env.USER_POOL_ID || 'us-east-1_xxxxxxxxx';
const CLIENT_ID = process.env.CLIENT_ID || 'your-client-id';
const FRONTEND_URL = process.env.FRONTEND_URL || '*';

// aws-jwt-verify を使った Cognito 用バリデータの初期化
const jwtVerifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: 'access', // または 'id'
  clientId: CLIENT_ID,
});

// Bedrock Runtime クライアントの初期化
// 画像生成モデルやクロスリージョンに対応するため、オレゴン (us-west-2) を指定
const bedrockClient = new BedrockRuntimeClient({ region: "us-west-2" });

export const handler = awslambda.streamifyResponse(
    async (event: APIGatewayProxyEventV2, responseStream: NodeJS.WritableStream, context: Context) => {

        const corsHeaders = {
            "Access-Control-Allow-Origin": FRONTEND_URL,
            "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
            "Access-Control-Allow-Headers": "Content-Type,X-User-Token,x-amz-content-sha256",
        };

        const httpMethod = event.requestContext?.http?.method || 'GET';

        // OPTIONSリクエスト（プリフライト）の処理
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

            // 専用のカスタムヘッダーからJWTトークンを取得
            const authHeader = event.headers?.['x-user-token'] || event.headers?.['X-User-Token'];
            //const authHeader = event.headers?.authorization || event.headers?.Authorization;
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

            // aws-jwt-verify を使ってトークンを検証（無効な場合は例外がスローされます）
            const payloadJwt = await jwtVerifier.verify(token);
            console.log("JWT検証成功！ユーザーID:", payloadJwt.sub);

            // Bedrock呼び出し処理
            const body = event.body ? JSON.parse(event.body) : {};
            const subject = body.subject || "AIへの指示";

            // 認証成功＆データ準備完了のレスポンスヘッダー設定（ストリーミング用）
            const httpResponseMetadata = {
                statusCode: 200,
                headers: {
                    ...corsHeaders,
                    "Content-Type": "text/plain; charset=utf-8",
                    "Transfer-Encoding": "chunked",
                },
            };

            const stream = awslambda.HttpResponseStream.from(responseStream as any, httpResponseMetadata);

            const prompt = `
                あなたは特撮ヒーローの熱い変身シーンの実況ナレーターです。
                ユーザーが指定したお題 「ヒーロー名（またはモチーフ)」の変身プロセスを以下の【全3ステップ】に分けてドラマチックに実況、解説してください。

                対象のお題: ${subject}

                【ルール】
                - 必ず「第1段階」「第2段階」「最終段階」の3つのステップで展開してください。
                - 各ステップの終わり（または盛り上がり）で、そのシーンにふさわしいイラストの指示を必ず [IMAGE: 英語の画像プロンプト] の形式で文章の中に挟んでください。
                - 語尾は「〜である！」「〜のだ！」「～にすぎない！」など特撮風にしてください。

                出力例:
                「第1段階：予兆！[IMAGE: ... text ...] 第2段階：蒸着！[IMAGE: ... text ...] 最終段階：覚醒！[IMAGE: ... text ...]」
            `;

            const payload = {
                anthropic_version: "bedrock-2023-05-31",
                max_tokens: 1200,
                messages: [{ role: "user", content: prompt }],
            };

            const command = new InvokeModelWithResponseStreamCommand({
                modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
                contentType: "application/json",
                accept: "application/json",
                body: JSON.stringify(payload),
            });

            const bedrockResponse = await bedrockClient.send(command);

            if (bedrockResponse.body) {
                let textBuffer = ""; // マーカー検知用のバッファ

                for await (const chunk of bedrockResponse.body) {
                    if (chunk.chunk && chunk.chunk.bytes) {
                        const parsed = JSON.parse(new TextDecoder().decode(chunk.chunk.bytes));

                        if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                            const textChunk = parsed.delta.text;
                            textBuffer += textChunk;

                            // [IMAGE: ◯◯] のパターンを正規表現で探す
                            const regex = /\[IMAGE:\s*([^\]]+)\]/g;
                            let match;
                            let lastIndex = 0;

                            while ((match = regex.exec(textBuffer)) !== null) {
                                // マーカーの手前までの通常のテキストを送信
                                const normalText = textBuffer.substring(lastIndex, match.index);
                                if (normalText) {
                                    stream.write(JSON.stringify({ type: "text", content: normalText }) + '\n');
                                }

                                // 画像生成の処理
                                const imagePrompt = match[1].trim();

                                try {
                                    const imageBase64 = await generateImageWithStableCore(imagePrompt);
                                    stream.write(JSON.stringify({
                                        type: "image_result",
                                        prompt: imagePrompt,
                                        data: imageBase64
                                    }) + '\n');
                                } catch (imgErr) {
                                    console.error("Image Generation Error:", imgErr);
                                }

                                lastIndex = regex.lastIndex;
                            }

                            // まだマッチしていない残りのテキストを保持
                            textBuffer = textBuffer.substring(lastIndex);

                            // マーカーが含まれていない通常のテキストであればそのまま送信
                            if (textBuffer && !textBuffer.includes('[')) {
                                stream.write(JSON.stringify({ type: "text", content: textBuffer }) + '\n');
                                textBuffer = "";
                            }
                        }
                    }
                }

                // 最後にバッファに残ったテキストがあれば送信
                if (textBuffer.trim()) {
                    stream.write(JSON.stringify({ type: "text", content: textBuffer }) + '\n');
                }
            }

            // すべての書き込みが終わったらストリームを閉じる
            stream.end();

        } catch (error: any) {
            console.error("処理エラー:", error);
            const errorMetadata = {
                statusCode: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            };
            const stream = awslambda.HttpResponseStream.from(responseStream as any, errorMetadata);
            stream.write(JSON.stringify({ error: `Unauthorized: ${error.message}` }));
            stream.end();
        }
    }
);

// Stable Image Core を呼び出してBase64画像を返す関数
async function generateImageWithStableCore(promptText: string): Promise<string> {

    const modelId = "stability.stable-image-core-v1:1";

    const payload = {
        prompt: promptText,
        output_format: "jpeg",
    };

    const command = new InvokeModelCommand({
        modelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(payload),
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    // Stable Image Core のレスポンスは images 配列の中に Base64 文字列が入っています
    if (responseBody.images && responseBody.images.length > 0) {
        return responseBody.images[0];
    }

    throw new Error("No image data returned from Stable Image Core");
}
