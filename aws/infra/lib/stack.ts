import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as amplify from 'aws-cdk-lib/aws-amplify';
import {Construct} from 'constructs';
import {fileURLToPath} from 'node:url';

/** Cooling Planner on AWS:
 *  - cooling-planner-mcp: stateless streamable-HTTP MCP endpoint (Function URL)
 *  - cooling-planner-api: REST adapter for the same domain core (Function URL)
 *  - Amplify app (manual deploy mode): serves dist-offline/
 *  Both Function URLs are authType NONE; handlers enforce a shared Bearer token
 *  supplied via the `mcpBearerToken` CDK context (managed by aws/deploy.mjs). */
export class CoolingPlannerStack extends cdk.Stack{
 constructor(scope:Construct,id:string,props?:cdk.StackProps){
  super(scope,id,props);
  const token=this.node.tryGetContext('mcpBearerToken') as string|undefined;
  if(!token)throw new Error('CDK context mcpBearerToken is required — deploy via `node aws/deploy.mjs`');
  const distDir=fileURLToPath(new URL('../../dist',import.meta.url));

  const shared={
   runtime:lambda.Runtime.NODEJS_22_X,
   memorySize:1024,
   timeout:cdk.Duration.seconds(180),
   environment:{MCP_BEARER_TOKEN:token},
  };
  const mcpFn=new lambda.Function(this,'McpFunction',{
   functionName:'cooling-planner-mcp',
   code:lambda.Code.fromAsset(distDir),
   handler:'mcp.lambdaHandler',
   ...shared,
  });
  const apiFn=new lambda.Function(this,'ApiFunction',{
   functionName:'cooling-planner-api',
   code:lambda.Code.fromAsset(distDir),
   handler:'api.lambdaHandler',
   ...shared,
  });
  const mcpUrl=mcpFn.addFunctionUrl({authType:lambda.FunctionUrlAuthType.NONE});
  const apiUrl=apiFn.addFunctionUrl({authType:lambda.FunctionUrlAuthType.NONE,cors:{
   allowedOrigins:['*'],
   allowedMethods:[lambda.HttpMethod.GET,lambda.HttpMethod.POST],
   allowedHeaders:['authorization','content-type'],
  }});

  // Manual-deploy Amplify app (no repository connection). GitHub auto-deploy is
  // enabled later by connecting the repo once in the Amplify console.
  const amplifyApp=new amplify.CfnApp(this,'AmplifyApp',{name:'cooling-planner',platform:'WEB'});
  new amplify.CfnBranch(this,'AmplifyMainBranch',{appId:amplifyApp.attrAppId,branchName:'main',stage:'PRODUCTION'});

  new cdk.CfnOutput(this,'McpUrl',{value:mcpUrl.url});
  new cdk.CfnOutput(this,'ApiUrl',{value:apiUrl.url});
  new cdk.CfnOutput(this,'AmplifyAppId',{value:amplifyApp.attrAppId});
  new cdk.CfnOutput(this,'AmplifyUrl',{value:`https://main.${amplifyApp.attrDefaultDomain}`});
 }
}
