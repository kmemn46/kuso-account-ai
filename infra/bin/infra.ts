#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { InfraStack, InfraStackProps } from '../lib/infra-stack';

const app = new cdk.App();

// コンテキストから環境名を取得（デフォルトはdev）
const rawEnvKey   = app.node.tryGetContext('env') || 'dev';
const envKey = rawEnvKey as 'dev' | 'prod';

// 環境ごとの個別設定
const envConfig = {
  dev: {
    envName: 'dev',
    removalPolicy: cdk.RemovalPolicy.DESTROY, // 開発は削除時にリソース破棄
    bedrockModelIds: {
      text: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      image: 'stability.stable-image-core-v1:1',
    },
  },
  prod: {
    envName: 'prod',
    removalPolicy: cdk.RemovalPolicy.RETAIN, // 本番はデータを絶対保持
    bedrockModelIds: {
      text: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      image: 'stability.stable-image-core-v1:1',
    },
  }
} as const;

const props: InfraStackProps = {
  envName: envConfig[envKey].envName,
  removalPolicy: envConfig[envKey].removalPolicy,
  bedrockModelIds: envConfig[envKey].bedrockModelIds,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  tags: {
    Environment: envConfig[envKey].envName,
    Project: 'Kuso-App-Park',
    ManagedBy: 'CDK',
  },
}

new InfraStack(app, `InfraStack-${envConfig[envKey].envName}`, props);

//new InfraStack(app, `InfraStack-${envConfig[envKey].envName}`, {
  /* If you don't specify 'env', this stack will be environment-agnostic.
   * Account/Region-dependent features and context lookups will not work,
   * but a single synthesized template can be deployed anywhere. */

  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

  /* Uncomment the next line if you know exactly what Account and Region you
   * want to deploy the stack to. */
  // env: { account: '123456789012', region: 'us-east-1' },

  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */

  // envName: envConfig[envKey].envName,
  // removalPolicy: envConfig[envKey].removalPolicy,
  // env: {
  //   account: process.env.CDK_DEFAULT_ACCOUNT,
  //   region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  // },
//});
