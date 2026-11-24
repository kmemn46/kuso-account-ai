import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface GitHubOidcStackProps extends cdk.StackProps {
    /**
     * GitHub OIDC の default subject claim prefix に合わせた識別子
     * 例: "owner@1234567/repo@7654321"
     */
    githubRepoSubjectPrefix: string;

    /**
     * IAM ロール名などに使うリポジトリ名（任意・未指定ならプレフィックス末尾から抽出）
     */
    roleNamePrefix?: string;
}

export class GitHubOidcStack extends cdk.Stack {
    public readonly deployRole: iam.Role;

    constructor(scope: Construct, id: string, props: GitHubOidcStackProps) {
        super(scope, id, props);

        const { githubRepoSubjectPrefix, roleNamePrefix } = props;

        // 例: "owner@1234567/repo@7654321" から "repo" 部分を安全に取り出す
        const repoPart =
            roleNamePrefix ??
            githubRepoSubjectPrefix.split("/")[1]?.split("@")[0] ??
            "github-actions";

        // GitHub Actions 用の OIDC プロバイダを作成
        // ※すでに同じAWSアカウント内で作成済みの場合は OpenIdConnectProvider.fromOpenIdConnectProviderArn で参照してください
        const githubProvider = new iam.OpenIdConnectProvider(this, 'GitHubProvider', {
            url: 'https://token.actions.githubusercontent.com',
            clientIds: ['sts.amazonaws.com'],
        });

        // 「main ブランチ」と「pull_request」の2つに限定する
        const allowedSubjects: string[] = [
            `repo:${githubRepoSubjectPrefix}:ref:refs/heads/main`,
            `repo:${githubRepoSubjectPrefix}:pull_request`,
        ];

        // 自分の特定リポジトリからの実行のみに制限する（超重要セキュリティ設定）
        const conditions: iam.Conditions = {
            StringEquals: {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            },
            StringLike: {
                "token.actions.githubusercontent.com:sub": allowedSubjects,
            },
        };

        // GitHub Actions が引き受ける IAM Role を作成
        this.deployRole = new iam.Role(this, 'GitHubActionsDeployRole', {
            roleName: `${repoPart}-github-actions-deploy-role`,
            assumedBy: new iam.WebIdentityPrincipal(
                githubProvider.openIdConnectProviderArn,
                conditions
            ),
            description: `OIDC role for ${githubRepoSubjectPrefix}`,
            maxSessionDuration: cdk.Duration.hours(1),  // セッションの最大有効期限
        });

        // CDKデプロイに必要な権限を付与
        // CDK Bootstrapで作成された専用ロール（cdk-hnb659fds-*）を引き受ける権限を付与するのが最もクリーンで安全
        this.deployRole.addToPolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['sts:AssumeRole'],
                resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
            })
        );

        // GitHub Actions のシークレット（AWS_ROLE_ARN）に設定する値を出力
        new cdk.CfnOutput(this, 'GitHubActionsRoleArn', {
            value: this.deployRole.roleArn,
            exportName: 'GitHubActionsDeployRoleArn',
            description: 'Set this ARN in GitHub Repository Secrets as AWS_ROLE_ARN',
        });
    }

}
