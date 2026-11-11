export type CompactIntent='expand'|'volume';
export type CompactFlow={phase:'orb'|'controls'|'merging'|'expand'|'volume';pending:CompactIntent|null};
export type CompactFlowEvent={type:'reveal'|'reset'|'settled'}|{type:'request';intent:CompactIntent};
export const initialCompactFlow:CompactFlow={phase:'orb',pending:null};
export function compactFlowReducer(state:CompactFlow,event:CompactFlowEvent):CompactFlow {
  if(event.type==='reset')return initialCompactFlow;
  if(event.type==='settled')return state.phase==='merging'&&state.pending?{phase:state.pending,pending:null}:state;
  if(event.type==='reveal')return state.phase==='orb'?{phase:'controls',pending:null}:state;
  if(event.type!=='request')return state;
  if(state.phase==='merging')return state.pending==='expand'?state:{phase:'merging',pending:event.intent};
  if(state.phase==='controls'||state.phase==='volume'&&event.intent==='expand')return {phase:'merging',pending:event.intent};
  return {phase:event.intent,pending:null};
}
