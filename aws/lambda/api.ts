/** REST adapter on a Lambda Function URL. Thin wrapper over the same domain
 * path as the MCP endpoint — routes:
 *   GET  /health    -> {ok, version}
 *   GET  /model     -> describe_model payload (default project)
 *   POST /simulate  -> evaluate body {project?, scenarioId?, operations?, includeDaily?}
 * Auth: shared Bearer token (Function URL is authType NONE). */
import {describe,evaluateProject} from './core.js';
import {APP_VERSION} from '../../src/data/defaults.js';

// Private token + published demo token (see mcp.ts).
const TOKENS=new Set([process.env.MCP_BEARER_TOKEN,process.env.MCP_DEMO_TOKEN].filter(Boolean) as string[]);

const json=(statusCode:number,data:unknown)=>({statusCode,headers:{'content-type':'application/json'},body:JSON.stringify(data)});

interface FunctionUrlEvent{
 rawPath:string;rawQueryString?:string;body?:string;isBase64Encoded?:boolean;
 headers?:Record<string,string>;
 requestContext:{http:{method:string}};
}

export async function lambdaHandler(event:FunctionUrlEvent){
 const auth=event.headers?.authorization??event.headers?.Authorization??'';
 if(TOKENS.size&&!TOKENS.has(auth.startsWith('Bearer ')?auth.slice(7):''))return json(401,{error:'unauthorized'});
 const method=event.requestContext.http.method,path=event.rawPath;
 console.log(JSON.stringify({method,path})); // evidence log for CloudWatch
 if(method==='GET'&&path==='/health')return json(200,{ok:true,version:APP_VERSION});
 if(method==='GET'&&path==='/model')return json(200,describe());
 if(method!=='POST'||path!=='/simulate')return json(404,{error:'not found'});
 try{
  const input=event.body?JSON.parse(Buffer.from(event.body,event.isBase64Encoded?'base64':'utf8').toString()):{};
  return json(200,await evaluateProject(input));
 }catch(e){
  return json(400,{error:e instanceof Error?e.message:String(e)});
 }
}
