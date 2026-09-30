import type {CommandMap} from './commands.js';

export interface BridgeOptions{
 url:string;
 commands:CommandMap;
 notify:(message:string)=>void;
}
interface BridgeRequest{id?:unknown;command?:unknown;args?:unknown}

/** One WebSocket per page; executes commands against the live UI and answers on the same socket.
 * The Node MCP process owns reconnection policy — on close the user reloads the page. */
export function startMcpBridge(opts:BridgeOptions){
 let ws:WebSocket;
 try{ws=new WebSocket(opts.url)}catch{opts.notify('Could not start the MCP bridge');return}
 const reply=(id:unknown,payload:Record<string,unknown>)=>{try{ws.send(JSON.stringify({id,...payload}))}catch{}};
 ws.onmessage=ev=>{
  let msg:BridgeRequest;
  try{msg=JSON.parse(String(ev.data))}catch{return}
  const{id,command,args}=msg;
  if(typeof id!=='number'||typeof command!=='string')return;
  const fn=(opts.commands as unknown as Record<string,(a?:unknown)=>unknown>)[command];
  if(!fn){reply(id,{ok:false,error:`unknown command: ${command}`});return}
  try{Promise.resolve(fn(args)).then(data=>reply(id,{ok:true,data})).catch(e=>reply(id,{ok:false,error:e instanceof Error?e.message:String(e)}))}catch(e){reply(id,{ok:false,error:e instanceof Error?e.message:String(e)})}
 };
 ws.onclose=ev=>{opts.notify(ev.reason?`MCP connection closed: ${ev.reason}`:'MCP connection closed. Reload the page to reconnect')};
}
