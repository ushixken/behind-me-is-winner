(function(){
  'use strict';
  function pointSegmentDistance(point,a,b){
    var dx=b.x-a.x,dy=b.y-a.y,lengthSquared=dx*dx+dy*dy;if(!lengthSquared)return Math.hypot(point.x-a.x,point.y-a.y);
    var t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/lengthSquared)),x=a.x+t*dx,y=a.y+t*dy;return Math.hypot(point.x-x,point.y-y);
  }
  function simplifyOpen(points,tolerance){
    if(points.length<=2)return points.slice();var maxDistance=0,index=0,last=points.length-1;
    for(var i=1;i<last;i++){var distance=pointSegmentDistance(points[i],points[0],points[last]);if(distance>maxDistance){maxDistance=distance;index=i;}}
    if(maxDistance<=tolerance)return[points[0],points[last]];
    var left=simplifyOpen(points.slice(0,index+1),tolerance),right=simplifyOpen(points.slice(index),tolerance);return left.slice(0,-1).concat(right);
  }
  function simplifyClosed(points,tolerance){
    if(points.length<8)return points.slice();var anchor=1,maxDistance=0;
    for(var i=1;i<points.length;i++){var distance=Math.hypot(points[i].x-points[0].x,points[i].y-points[0].y);if(distance>maxDistance){maxDistance=distance;anchor=i;}}
    var first=simplifyOpen(points.slice(0,anchor+1),tolerance),second=simplifyOpen(points.slice(anchor).concat([points[0]]),tolerance);
    return first.slice(0,-1).concat(second.slice(0,-1));
  }
  function turnAngle(a,b,c){
    var ax=b.x-a.x,ay=b.y-a.y,bx=c.x-b.x,by=c.y-b.y,al=Math.hypot(ax,ay),bl=Math.hypot(bx,by);if(al<.001||bl<.001)return 0;
    return Math.acos(Math.max(-1,Math.min(1,(ax*bx+ay*by)/(al*bl))))*180/Math.PI;
  }
  function append(commands,rawPoints){
    var points=simplifyClosed(rawPoints,.6),count=points.length;if(count<3)return;
    var start={x:(points[count-1].x+points[0].x)/2,y:(points[count-1].y+points[0].y)/2};commands.push({type:'move',x:start.x,y:start.y});
    for(var i=0;i<count;i++){
      var previous=points[(i-1+count)%count],current=points[i],next=points[(i+1)%count],end={x:(current.x+next.x)/2,y:(current.y+next.y)/2};
      if(turnAngle(previous,current,next)>=65)commands.push({type:'line',x:current.x,y:current.y},{type:'line',x:end.x,y:end.y});
      else commands.push({type:'quadratic',cx:current.x,cy:current.y,x:end.x,y:end.y});
    }
    commands.push({type:'close'});
  }
  window.BinaryContourSmoothing={append:append};
})();
