import {useEffect,useState} from 'react';
import {cacheIdentity} from '../favoriteOutbox.js';
import {getToken} from '../api.js';
export function readOnboardPreferences(scope) {
  if(!scope)return null;
  try{return JSON.parse(localStorage.getItem('velocity.onboard.'+scope)||'null');}catch{return null;}
}
export function useOnboardPreferences(email,authed) {
  const scope=authed?cacheIdentity(email,getToken()):'';
  const [saved,setSaved]=useState(()=>({scope,value:readOnboardPreferences(scope)}));
  const value=saved.scope===scope?saved.value:readOnboardPreferences(scope);
  useEffect(()=>{setSaved({scope,value:readOnboardPreferences(scope)});},[scope]);
  const setValue=next=>{
    if(!scope)return;
    const result=typeof next==='function'?next(value):next;
    try{localStorage.setItem('velocity.onboard.'+scope,JSON.stringify(result));}catch{ /* preferences remain in memory */ }
    setSaved({scope,value:result});
  };
  return [value,setValue];
}
