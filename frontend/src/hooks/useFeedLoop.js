import {useEffect,useRef} from 'react';

// The second copy is a visual bridge. Rebase onto the identical first copy
// before the bridge can be interacted with; the DOM stays bounded to two cycles.
export function useFeedLoop(contentKey){
  const firstRef=useRef(null),repeatRef=useRef(null);
  useEffect(()=>{
    const first=firstRef.current,repeat=repeatRef.current;
    if(!first||!repeat)return;
    let scroller=first.parentElement;
    while(scroller&&!/(auto|scroll)/.test(getComputedStyle(scroller).overflowY))scroller=scroller.parentElement;
    if(!scroller)return;
    const rebase=()=>{
      const top=scroller.getBoundingClientRect().top;
      const a=first.getBoundingClientRect(),b=repeat.getBoundingClientRect();
      const period=b.top-a.top;
      if(period>0&&b.top<=top)scroller.scrollTop-=period;
    };
    scroller.addEventListener('scroll',rebase,{passive:true});
    return()=>scroller.removeEventListener('scroll',rebase);
  },[contentKey]);
  return {firstRef,repeatRef};
}
