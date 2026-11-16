import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';

// パラメータ設定（環境変数などから取得）
const region = process.env.AWS_REGION || "us-east-1";
const dynamoClient = new DynamoDBClient({ region });           // DynamoDB クライアントの初期化
const docClient = DynamoDBDocumentClient.from(dynamoClient);   // DynamoDB クライアントのラッパー

const FRONTEND_URL = process.env.FRONTEND_URL || '*';
const TABLE_NAME = process.env.TABLE_NAME || "";

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {

    const headers = {
        "Access-Control-Allow-Origin": FRONTEND_URL,
        "Access-Control-Allow-Methods": "OPTIONS,GET",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Content-Type": "application/json",
    };

    const httpMethod = event.requestContext?.http?.method || 'GET';

    // OPTIONS（プリフライト）リクエストの対応
    if (httpMethod === "OPTIONS") {
        return { statusCode: 200, headers, body: "" };
    }

    try {

        const claims = event.requestContext?.authorizer?.jwt?.claims
        const userId = claims?.sub;

        if (!claims) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ message: "Unauthorized: Missing user sub" }),
            };
        }

        // GSI (UserSessionsIndex) を使って、ユーザーごとのセッション一覧を効率よく取得する
        const queryResult = await docClient.send(
            new QueryCommand({
                TableName: TABLE_NAME,
                IndexName: "UserSessionsIndex", // CDK側で定義したGSIの名前を指定
                KeyConditionExpression: "userId = :userId",
                ExpressionAttributeValues: {
                    ":userId": userId,
                    ":meta": "METADATA", // メタデータレコードを指定
                },
                FilterExpression: "#ts = :meta",  // timestamp が METADATA であるものだけをフィルタリング
                ExpressionAttributeNames: {
                    "#ts": "timestamp",
                },
                ScanIndexForward: false,        // updatedAt の新しい順（降順）で取得
            })
        );

        const items = queryResult.Items || [];

        // フロントエンドが使いやすい形（sessionId, title, updatedAt）に整えて返す
        const sessions = items.map((item) => ({
            sessionId: item.sessionId,
            title: item.title || "新しいチャット",
            updatedAt: item.updatedAt,
        }));

        // 取得したセッション一覧をJSON形式でフロントエンドに返す
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ sessions }),
        };

    } catch (error: any) {
        console.error("Error fetching sessions with Cognito sub:", error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ message: "Internal Server Error", error: String(error) }),
        }
    }

}
