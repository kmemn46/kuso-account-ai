import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface BedrockGuardrailProps {
    /** 環境 */
    envName: string;
}

export class BedrockGuardrailConstruct extends Construct {

    public readonly guardrailId: string;
    public readonly guardrailVersion: string;
    public readonly guardrailArn: string;

    constructor(scope: Construct, id: string, props: BedrockGuardrailProps) {
        super(scope, id);

        const { envName } = props;

        // ==========================================
        // 1. ガードレール本体の定義（DRAFT）
        // ==========================================
        const guardrail = new bedrock.CfnGuardrail(this, 'BedrockGuardrail', {
            name: `${envName}-genai-app-guardrail`,
            description: 'Guardrail for content safety, prompt injection protection, and PII masking',
            // ブロック時にユーザーへ返す定型メッセージ
            blockedInputMessaging: '申し訳ありませんが、セキュリティおよび安全基準に抵触する内容が含まれているため処理できません。',
            blockedOutputsMessaging: '申し訳ありませんが、適切な回答を生成できませんでした。質問を変えてお試しください。',

            // コンテンツフィルター（有害表現 ＆ プロンプトインジェクション対策）
            contentPolicyConfig: {
                filtersConfig: [
                    { type: 'HATE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
                    { type: 'INSULTS', inputStrength: 'HIGH', outputStrength: 'HIGH' },
                    { type: 'SEXUAL', inputStrength: 'HIGH', outputStrength: 'HIGH' },
                    { type: 'VIOLENCE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
                    { type: 'MISCONDUCT', inputStrength: 'HIGH', outputStrength: 'HIGH' },
                    // プロンプト攻撃（脱獄・システムプロンプト漏洩狙い）のブロック
                    { type: 'PROMPT_ATTACK', inputStrength: 'HIGH', outputStrength: 'NONE' },
                ],
            },

            // 機密情報（PII）の保護設定（入力された個人情報を自動マスキング、またはブロック）
            sensitiveInformationPolicyConfig: {
                piiEntitiesConfig: [
                    { type: 'EMAIL', action: 'ANONYMIZE' },       // メールアドレスを匿名化（例: {EMAIL} に置換）
                    { type: 'PHONE', action: 'ANONYMIZE' },       // 電話番号を匿名化
                    { type: 'CREDIT_DEBIT_CARD_NUMBER', action: 'BLOCK' }, // クレカ番号は即ブロック
                    { type: 'AWS_ACCESS_KEY', action: 'BLOCK' },  // AWSアクセスキーは即ブロック
                ],
            },
        });

        // ==========================================
        // 2. 確定バージョンの発行（スナップショット作成）
        // ==========================================
        const guardrailVersion = new bedrock.CfnGuardrailVersion(this, 'BedrockGuardrailVersion', {
            guardrailIdentifier: guardrail.attrGuardrailId,
            description: `Production version for ${envName}`,
        });

        this.guardrailId = guardrail.attrGuardrailId;
        this.guardrailVersion = guardrailVersion.attrVersion;
        this.guardrailArn = guardrail.attrGuardrailArn;
    }

    // 権限付与のヘルパーメソッド
    public grantApply(grantee: iam.IGrantable): iam.Grant {
        return iam.Grant.addToPrincipal({
            grantee,
            actions: ['bedrock:ApplyGuardrail'],
            resourceArns: [this.guardrailArn],
        });
    }
}