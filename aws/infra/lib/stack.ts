import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import {Construct} from 'constructs';
import {fileURLToPath} from 'node:url';

/** Cooling Planner on AWS:
 *  - cooling-planner-mcp: stateless streamable-HTTP MCP endpoint (Function URL)
 *  - cooling-planner-api: REST adapter for the same domain core (Function URL)
 *  The static site is hosted by a GitHub-connected Amplify app (console-managed,
 *  auto-deploys on push to main via amplify.yml) — not part of this stack.
 *  Both Function URLs are authType NONE; handlers enforce a shared Bearer token
 *  supplied via the `mcpBearerToken` CDK context (managed by aws/deploy.mjs). */
export class CoolingPlannerStack extends cdk.Stack{
 constructor(scope:Construct,id:string,props?:cdk.StackProps){
  super(scope,id,props);
  const token=this.node.tryGetContext('mcpBearerToken') as string|undefined;
  if(!token)throw new Error('CDK context mcpBearerToken is required — deploy via `node aws/deploy.mjs`');
  const demoToken=this.node.tryGetContext('mcpDemoToken') as string|undefined;
  const distDir=fileURLToPath(new URL('../../dist',import.meta.url));

  const shared={
   runtime:lambda.Runtime.NODEJS_22_X,
   memorySize:1024,
   timeout:cdk.Duration.seconds(180),
   environment:{MCP_BEARER_TOKEN:token,...(demoToken?{MCP_DEMO_TOKEN:demoToken}:{})},
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

  new cdk.CfnOutput(this,'McpUrl',{value:mcpUrl.url});
  new cdk.CfnOutput(this,'ApiUrl',{value:apiUrl.url});
 }
}
