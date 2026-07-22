(function(){
  'use strict';
  function binaryAt(mask,x,y){return x>=0&&y>=0&&x<CW&&y<CH&&mask[y*CW+x]?1:0;}
  function buildContourPath(mask,bounds){
    var segments=[],minX=Math.max(-1,bounds.x-1),minY=Math.max(-1,bounds.y-1),maxX=Math.min(CW-1,bounds.x+bounds.w),maxY=Math.min(CH-1,bounds.y+bounds.h);
    function point(x,y){return{x:x,y:y};}function add(a,b){segments.push([a,b]);}
    for(var y=minY;y<=maxY;y++)for(var x=minX;x<=maxX;x++){
      var code=binaryAt(mask,x,y)|(binaryAt(mask,x+1,y)<<1)|(binaryAt(mask,x+1,y+1)<<2)|(binaryAt(mask,x,y+1)<<3);if(!code||code===15)continue;
      var top=point(x+1,y+.5),right=point(x+1.5,y+1),bottom=point(x+1,y+1.5),left=point(x+.5,y+1);
      if(code===1)add(left,top);else if(code===2)add(top,right);else if(code===3)add(left,right);else if(code===4)add(right,bottom);
      else if(code===5){add(left,top);add(right,bottom);}else if(code===6)add(top,bottom);else if(code===7)add(left,bottom);
      else if(code===8)add(bottom,left);else if(code===9)add(bottom,top);else if(code===10){add(top,right);add(bottom,left);}
      else if(code===11)add(bottom,right);else if(code===12)add(right,left);else if(code===13)add(right,top);else if(code===14)add(top,left);
    }
    var adjacency=new Map();function key(p){return Math.round(p.x*2)+','+Math.round(p.y*2);}function link(index,end){var k=key(segments[index][end]),list=adjacency.get(k);if(!list){list=[];adjacency.set(k,list);}list.push({index:index,end:end});}
    for(var i=0;i<segments.length;i++){link(i,0);link(i,1);}var used=new Uint8Array(segments.length),commands=[];
    for(var startIndex=0;startIndex<segments.length;startIndex++){if(used[startIndex])continue;var first=segments[startIndex][0],current=segments[startIndex][1],startKey=key(first),contour=[first,current];used[startIndex]=1;
      while(key(current)!==startKey){var choices=adjacency.get(key(current))||[],next=null;for(var c=0;c<choices.length;c++)if(!used[choices[c].index]){next=choices[c];break;}if(!next)break;used[next.index]=1;current=segments[next.index][next.end?0:1];if(key(current)!==startKey)contour.push(current);}
      BinaryContourSmoothing.append(commands,contour);
    }return commands;
  }
  function apply(mask,bounds,color){
    if(!window.FillMaskEngine||!mask||!bounds||!bounds.w||!bounds.h)return false;var commands=buildContourPath(mask,bounds);if(!commands.length)return false;
    return FillMaskEngine.applyPath(commands,bounds,{color:color,fillRule:'evenodd',manageDocument:false,selectionClipped:true});
  }
  window.BucketFillAA={apply:apply};
})();
