import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface GitHubOidcStackProps extends cdk.StackProps {
    githubOrg: string;   // GitHUbのユーザ名またはOrganization名 （例: 'your-username'）
    githubRepo: string;  // GitHubのリポジトリ名 (例: 'your-monorepo-name')
    branchName: string; // "main"（厳格に限定する）
}

export class GitHubOidcStack extends cdk.Stack {
    public readonly deployRole: iam.Role;

    constructor(scope: Construct, id: string, props: GitHubOidcStackProps) {
        super(scope, id, props);

        const { githubOrg, githubRepo, branchName } = props;

        // 1. GitHub Actions 用の OIDC プロバイダを作成
        // ※すでに同じAWSアカウント内で作成済みの場合は OpenIdConnectProvider.fromOpenIdConnectProviderArn で参照してください
        const githubProvider = new iam.OpenIdConnectProvider(this, 'GitHubProvider', {
            url: 'https://token.actions.githubusercontent.com',
            clientIds: ['sts.amazonaws.com'],
        });

        // 2. 許可する GitHub のサブジェクト条件（`sub` クレーム）を組み立てる
        const repoClaim = `repo:${githubOrg}/${githubRepo}`;
        const subjectCondition = `${repoClaim}:ref:refs/heads/${branchName}`;
        const allowedSubjects: string[] = [
            subjectCondition,
            `${repoClaim}:pull_request`,
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

        // 3. GitHub Actions が引き受ける IAM Role を作成
        this.deployRole = new iam.Role(this, 'GitHubActionsDeployRole', {
            roleName: `${githubRepo}-github-actions-deploy-role`,
            assumedBy: new iam.WebIdentityPrincipal(
                githubProvider.openIdConnectProviderArn,
                conditions
            ),
            description: `OIDC role for deploying ${githubOrg}/${githubRepo} via GitHub Actions`,
            maxSessionDuration: cdk.Duration.hours(1),  // セッションの最大有効期限
        });

        // 4. CDKデプロイに必要な権限を付与
        // CDK Bootstrapで作成された専用ロール（cdk-hnb659fds-*）を引き受ける権限を付与するのが最もクリーンで安全
        this.deployRole.addToPolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['sts:AssumeRole'],
                resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
            })
        );

        // 5. GitHub Actions のシークレット（AWS_ROLE_ARN）に設定する値を出力
        new cdk.CfnOutput(this, 'GitHubActionsRoleArn', {
            value: this.deployRole.roleArn,
            exportName: 'GitHubActionsDeployRoleArn',
            description: 'Set this ARN in GitHub Repository Secrets as AWS_ROLE_ARN',
        });
    }

}
