import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface S3CloudFrontProps {
    /** 環境 */
    envName: string;
    removalPolicy: cdk.RemovalPolicy;
}

export class S3CloudFrontConstruct extends Construct {
    
    public readonly bucket: s3.Bucket;
    public readonly distribution: cloudfront.Distribution;

    constructor(scope: Construct, id: string, props: S3CloudFrontProps) {
        super(scope, id);

        const { envName, removalPolicy } = props;

        // ==========================================
        // 1. 静的ファイル保存用S3バケットの作成
        // ==========================================
        this.bucket = new s3.Bucket(this, 'NextjsWebsiteBucket', {
            bucketName: `${envName}-my-ai-app-data-bucket`,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,  // Public Access遮断
            removalPolicy: removalPolicy,
            autoDeleteObjects: removalPolicy === cdk.RemovalPolicy.DESTROY,  // スタック削除時に中身も削除（devの場合）
        });

        // ======================================================
        // 2. CloudFrontディストリビューションの作成（S3とOACで連携）
        // ======================================================
        this.distribution = new cloudfront.Distribution(this, 'NextjsDistribution', {
            comment: `Nextjs Distribution (${envName})`,
            defaultBehavior: {
                origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),       // OACの設定
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,   // HTTPS強制
            },
            defaultRootObject: 'index.html',
        });
    }
}
