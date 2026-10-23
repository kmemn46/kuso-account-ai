import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface S3CloudFrontProps {
  // 必要に応じてカスタム設定を追加できます
}

export class S3CloudFrontConstruct extends Construct {
    
    public readonly bucket: s3.Bucket;
    public readonly distribution: cloudfront.Distribution;

    constructor(scope: Construct, id: string, props?: S3CloudFrontProps) {
        super(scope, id);

        // ==========================================
        // 1. 静的ファイル保存用S3バケットの作成
        // ==========================================
        this.bucket = new s3.Bucket(this, 'NextjsWebsiteBucket', {
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,  // Public Access遮断
            removalPolicy: cdk.RemovalPolicy.DESTROY,           // 個人開発/検証用に削除しやすく  
            autoDeleteObjects: true,                            // スタック削除時に中身も削除
        });

        // ======================================================
        // 2. CloudFrontディストリビューションの作成（S3とOACで連携）
        // ======================================================
        this.distribution = new cloudfront.Distribution(this, 'NextjsDistribution', {
            defaultBehavior: {
                origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),       // OACの設定
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,   // HTTPS強制
            },
            defaultRootObject: 'index.html',
        });
    }
}
