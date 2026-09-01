export interface EZPIPELINEYAML {
  id: string;
  env?: string;
  appName: string;
  group?: string;
  description?: string;
  version: string;
  filePath?: string; // Added for frontend management

  steps: PipelineStep[];

  testCriteria?: TestCriteria;
  coverage?: CoverageRequirement;

  docker: DockerConfig;
  deployment: DeploymentConfig;
  kubernetes?: KubernetesConfig;
}

export interface PipelineStep {
  name: string;
  run: string; // shell command or script
  continueOnError?: boolean;
  timeoutSeconds?: number;
  retries?: number;
  env?: Record<string, string>;
  condition?: string; // bash expression or env-based condition
  cwd?: string; // current working dir
  shell?: string;
}

export interface TestCriteria {
  enabled: boolean;
  mustPass: boolean;
  command?: string; // optional custom test command
}

export interface CoverageRequirement {
  enabled: boolean;
  minimumPercent: number;
  reportFile?: string; // optional path to a coverage report file
}

export interface DockerConfig {
  imageName: string;
  dockerfilePath: string;
  context: string;
  tags?: string[];
  buildArgs?: Record<string, string>;
  push: boolean;
  registryUrl?: string; // optional support for self-hosted registries
}

export interface DeploymentConfig {
  provider: "aws" | "azure";
  region: string;
  credentialsSecret: string;

  awsConfig?: AWSDeployConfig;
  azureConfig?: AzureDeployConfig;
}

export interface AWSDeployConfig {
  ecrRepository: string;
  taskDefinition: string;
  cluster: string;
  service: string;
  assignPublicIp?: boolean;
  containerPort?: number;
}

export interface AzureDeployConfig {
  containerRegistry: string;
  resourceGroup: string;
  appServiceName: string;
  slotName?: string; // optional deployment slot
}

export interface KubernetesConfig {
  namespace: string;
  context?: string;
  deploymentFile: string;
  serviceFile?: string;
  imagePullSecret?: string;
  valuesFile?: string; // optional Helm values override
  helmChart?: string; // optional Helm chart name
}
