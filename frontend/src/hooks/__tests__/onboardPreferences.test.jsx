import {act,renderHook,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
vi.mock('../../api.js',()=>({getToken:()=>''}));
import {useOnboardPreferences} from '../useOnboardPreferences.js';
afterEach(()=>{cleanup();localStorage.clear();});
it('new accounts never inherit another account preferences, and returning accounts retain their choices',()=>{
 const {result,rerender}=renderHook(email=>useOnboardPreferences(email,true),{initialProps:'first@example.test'});
 act(()=>result.current[1]({genres:[{label:'Metal',q:'metal'}],artists:[{name:'Deftones'}]}));
 rerender('second@example.test');expect(result.current[0]).toBe(null);
 rerender('first@example.test');expect(result.current[0].artists[0].name).toBe('Deftones');
});
