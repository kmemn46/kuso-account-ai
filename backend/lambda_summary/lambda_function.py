import json
import os
from decimal import Decimal
import boto3

# Decimal型をJSONシリアライズするためのヘルパー関数
class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return int(o)
        return super(DecimalEncoder, self).default(o)

dynamodb = boto3.resource('dynamodb')
TABLE_NAME = os.environ['TABLE_NAME']
table = dynamodb.Table(TABLE_NAME)

# CloudFrontのURLを取得
CLOUDFRONT_URL = os.environ.get("CLOUDFRONT_URL", "*")

def lambda_handler(event, context):
    try:
        # API GatewayのオーソライザからJWTのクレームを取得
        authorizer = event.get('requestContext', {}).get('authorizer', {})
        claims = authorizer.get('jwt', {}).get('claims', {})

        # 'sub'（ユーザーの固有ID）を取得する
        user_id = claims.get('sub')
        if not user_id:
            return {
                'statusCode': 401,
                'body': json.dumps({'message': 'Unauthorized: ユーザーIDが見つかりません'})
            }
        
        # クエリパラメータまたはボディからtarget_monthを取得
        params = event.get('queryStringParameters') or {}
        target_month = params.get('month', '2026-10')

        pk = f"{user_id}#{target_month}"

        # DynamoDBから月単位でデータが一括取得（Query）
        response = table.query(
            KeyConditionExpression = boto3.dynamodb.conditions.Key('UserId_Month').eq(pk)
        )

        items = response.get('Items', [])

        # 集計ロジック（B/S・P/L用）
        total_debit = 0   # 借方合計（資産・費用など）
        total_credit = 0  # 貸方合計（負債・収益など）
        categories = {}

        for item in items:
            amount = int(item.get('amount', 0))
            total_debit += amount
            total_credit += amount

            # カテゴリ別のポジティブ集計
            cat = item.get('category', 'その他')
            categories[cat] = categories.get(cat, 0) + amount

        # 決算データまとめ
        summary_data = {
            'period': target_month,
            'total_transactions': len(items),
            'total_asset_value': total_debit, # ギャル的ポジティブ総資産
            'category_breakdown': categories,
            'journal_history': items
        }

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': CLOUDFRONT_URL
            },
            'body': json.dumps({
                'message': f'{target_month}の決算集計完了！超絶黒字経営だよ！✨',
                'summary': summary_data
            }, cls = DecimalEncoder, ensure_ascii = False)
        }

    except Exception as e:
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': str(e)})
        }

