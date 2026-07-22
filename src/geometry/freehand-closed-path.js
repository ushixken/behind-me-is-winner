(function(){
  'use strict';
  function midpoint(a,b){return{x:(a.x+b.x)/2,y:(a.y+b.y)/2};}
  function turnAngle(a,b,c){
    var ax=b.x-a.x,ay=b.y-a.y,bx=c.x-b.x,by=c.y-b.y,al=Math.hypot(ax,ay),bl=Math.hypot(bx,by);
    if(al<0.001||bl<0.001)return 0;
    return Math.acos(Math.max(-1,Math.min(1,(ax*bx+ay*by)/(al*bl))))*180/Math.PI;
  }
  function isIntentionalCorner(points,index){
    var count=points.length,previous=points[(index-1+count)%count],current=points[index],next=points[(index+1)%count];
    if(turnAngle(previous,current,next)<65)return false;
    var outerPrevious=points[(index-2+count)%count],outerNext=points[(index+2)%count];
    return turnAngle(outerPrevious,current,outerNext)>=60;
  }
  function build(points){
    var count=points.length,commands=[];if(count<3)return null;
    var start=midpoint(points[count-1],points[0]);commands.push({type:'move',x:start.x,y:start.y});
    for(var i=0;i<count;i++){
      var current=points[i],next=points[(i+1)%count],end=midpoint(current,next);
      if(isIntentionalCorner(points,i)){commands.push({type:'line',x:current.x,y:current.y});commands.push({type:'line',x:end.x,y:end.y});}
      else commands.push({type:'quadratic',cx:current.x,cy:current.y,x:end.x,y:end.y});
    }
    commands.push({type:'close'});return commands;
  }
  function trace(context,commands){
    context.beginPath();for(var i=0;i<commands.length;i++){var command=commands[i];
      if(command.type==='move')context.moveTo(command.x,command.y);
      else if(command.type==='line')context.lineTo(command.x,command.y);
      else if(command.type==='quadratic')context.quadraticCurveTo(command.cx,command.cy,command.x,command.y);
      else if(command.type==='cubic')context.bezierCurveTo(command.cx1,command.cy1,command.cx2,command.cy2,command.x,command.y);
      else if(command.type==='close')context.closePath();
    }
  }
  window.FreehandClosedPath={build:build,trace:trace};
})();
