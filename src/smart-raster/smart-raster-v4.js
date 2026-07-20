(function(root){
  'use strict';

  var VERSION=4;
  var TILE_SIZE=64;
  var MAX_STYLE_INDEX=65535;
  var MAX_COVERAGE=65535;
  var COVERAGE_SEMANTICS=Object.freeze({
    encoding:'unorm16',meaning:'accumulated-effective-normal-source-alpha',accumulation:'source-over-transmittance',
    includes:Object.freeze(['brush-mask','flow','pressure-opacity','stroke-opacity','antialiasing','texture','selection-clipping']),
    excludes:Object.freeze(['style-alpha','layer-opacity','brush-color','palette-order','blend-mode'])
  });

  function lifecycleFor(role){
    var native=role==='v4-native-empty';
    return {role:native?'v4-native':'shadow-diagnostic',state:native?'complete':'incomplete',authorityEligible:native,supportedModes:new Set(['normal']),observedModes:new Set(),supportedEdits:new Set(['normal-paint','color-erase','rgb-recolor','style-delete']),observedEdits:new Set(),incompleteReasons:new Set(native?[]:['shadow-diagnostic-only'])};
  }
  function cloneLifecycle(lifecycle){
    return {role:lifecycle.role,state:lifecycle.state,authorityEligible:!!lifecycle.authorityEligible,supportedModes:new Set(lifecycle.supportedModes),observedModes:new Set(lifecycle.observedModes),supportedEdits:new Set(lifecycle.supportedEdits),observedEdits:new Set(lifecycle.observedEdits),incompleteReasons:new Set(lifecycle.incompleteReasons)};
  }

  function positiveInteger(value,label){
    var number=Number(value);
    if(!Number.isInteger(number)||number<=0)throw new TypeError(label+' must be a positive integer');
    return number;
  }
  function validStyleIndex(value){
    var index=Number(value);
    if(!Number.isInteger(index)||index<=0||index>MAX_STYLE_INDEX)throw new RangeError('Smart Raster v4 style index is invalid');
    return index;
  }
  function validStyleId(value){
    if(value===null||value===undefined||String(value)==='')throw new TypeError('Smart Raster v4 style ID is required');
    return String(value);
  }
  function tileKey(tileX,tileY){
    tileX=Number(tileX);tileY=Number(tileY);
    if(!Number.isInteger(tileX)||!Number.isInteger(tileY)||tileX<0||tileY<0)throw new RangeError('Smart Raster v4 tile coordinates are invalid');
    return tileX+','+tileY;
  }
  function parseTileKey(key){
    var parts=String(key).split(',');
    if(parts.length!==2)throw new TypeError('Smart Raster v4 tile key is invalid');
    var tileX=Number(parts[0]),tileY=Number(parts[1]);
    if(!Number.isInteger(tileX)||!Number.isInteger(tileY)||tileX<0||tileY<0)throw new TypeError('Smart Raster v4 tile key is invalid');
    return {x:tileX,y:tileY};
  }
  function createFrame(width,height,options){
    width=positiveInteger(width,'Smart Raster v4 frame width');
    height=positiveInteger(height,'Smart Raster v4 frame height');
    return {
      version:VERSION,width:width,height:height,tileSize:TILE_SIZE,
      coverageSemantics:COVERAGE_SEMANTICS,lifecycle:lifecycleFor(options&&options.role),
      tiles:new Map(),styleTiles:new Map(),styleBounds:new Map(),dirtyTiles:new Set(),
      styleIdToIndex:new Map(),indexToStyleId:new Map(),nextStyleIndex:1
    };
  }
  function createShadowFrame(width,height){return createFrame(width,height,{role:'shadow-diagnostic'});}
  function createNativeFrame(width,height){return createFrame(width,height,{role:'v4-native-empty'});}
  function markFrameIncomplete(frame,reason){
    requireFrame(frame);reason=String(reason||'unspecified');frame.lifecycle.state='incomplete';frame.lifecycle.authorityEligible=false;frame.lifecycle.incompleteReasons.add(reason);return frame;
  }
  function noteBlendMode(frame,mode){
    requireFrame(frame);mode=String(mode||'normal');frame.lifecycle.observedModes.add(mode);if(!frame.lifecycle.supportedModes.has(mode))markFrameIncomplete(frame,'unsupported-blend-mode:'+mode);return frame;
  }
  function noteEdit(frame,operation){
    requireFrame(frame);operation=String(operation||'unknown-edit');frame.lifecycle.observedEdits.add(operation);if(!frame.lifecycle.supportedEdits.has(operation))markFrameIncomplete(frame,'unsupported-edit:'+operation);return frame;
  }  function isAuthorityEligible(frame){return isFrame(frame)&&frame.lifecycle.state==='complete'&&frame.lifecycle.authorityEligible===true&&frame.lifecycle.incompleteReasons.size===0;}
  function lifecycleSummary(frame){
    requireFrame(frame);return {role:frame.lifecycle.role,state:frame.lifecycle.state,authorityEligible:isAuthorityEligible(frame),supportedModes:Array.from(frame.lifecycle.supportedModes),observedModes:Array.from(frame.lifecycle.observedModes),supportedEdits:Array.from(frame.lifecycle.supportedEdits),observedEdits:Array.from(frame.lifecycle.observedEdits),incompleteReasons:Array.from(frame.lifecycle.incompleteReasons)};
  }
  function isFrame(frame){
    return !!frame&&frame.version===VERSION&&frame.tileSize===TILE_SIZE&&
      frame.tiles instanceof Map&&frame.styleTiles instanceof Map&&frame.styleBounds instanceof Map&&
      frame.dirtyTiles instanceof Set&&frame.styleIdToIndex instanceof Map&&frame.indexToStyleId instanceof Map&&
      frame.coverageSemantics===COVERAGE_SEMANTICS&&frame.lifecycle&&frame.lifecycle.supportedModes instanceof Set&&frame.lifecycle.observedModes instanceof Set&&frame.lifecycle.supportedEdits instanceof Set&&frame.lifecycle.observedEdits instanceof Set&&frame.lifecycle.incompleteReasons instanceof Set;
  }
  function requireFrame(frame){
    if(!isFrame(frame))throw new TypeError('Expected a Smart Raster v4 frame');
    return frame;
  }
  function ensureStyleIndex(frame,styleId){
    requireFrame(frame);styleId=validStyleId(styleId);
    var existing=frame.styleIdToIndex.get(styleId);
    if(existing)return existing;
    var index=Math.max(1,Number(frame.nextStyleIndex)||1);
    while(frame.indexToStyleId.has(index)&&index<=MAX_STYLE_INDEX)index++;
    if(index>MAX_STYLE_INDEX)throw new Error('Smart Raster v4 style index limit reached');
    frame.nextStyleIndex=index+1;
    frame.styleIdToIndex.set(styleId,index);frame.indexToStyleId.set(index,styleId);
    return index;
  }
  function getStyleIndex(frame,styleId){
    requireFrame(frame);return frame.styleIdToIndex.get(validStyleId(styleId))||0;
  }
  function getStyleId(frame,styleIndex){
    requireFrame(frame);return frame.indexToStyleId.get(validStyleIndex(styleIndex))||null;
  }
  function pixelLocation(frame,x,y){
    requireFrame(frame);x=Number(x);y=Number(y);
    if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=frame.width||y>=frame.height)throw new RangeError('Smart Raster v4 pixel coordinates are outside the frame');
    var tileX=Math.floor(x/TILE_SIZE),tileY=Math.floor(y/TILE_SIZE);
    return {tileX:tileX,tileY:tileY,key:tileKey(tileX,tileY),offset:(y-tileY*TILE_SIZE)*TILE_SIZE+(x-tileX*TILE_SIZE)};
  }
  function createTile(){return {styleChannels:new Map(),styleCounts:new Map()};}
  function ensureTile(frame,key){
    requireFrame(frame);parseTileKey(key);
    var tile=frame.tiles.get(key);
    if(!tile){tile=createTile();frame.tiles.set(key,tile);}
    return tile;
  }
  function includeStyleTile(frame,styleIndex,key){
    var keys=frame.styleTiles.get(styleIndex);
    if(!keys){keys=new Set();frame.styleTiles.set(styleIndex,keys);}
    keys.add(key);
    var point=parseTileKey(key),bounds=frame.styleBounds.get(styleIndex);
    if(!bounds){
      frame.styleBounds.set(styleIndex,{minTileX:point.x,minTileY:point.y,maxTileX:point.x,maxTileY:point.y});
      return;
    }
    bounds.minTileX=Math.min(bounds.minTileX,point.x);bounds.minTileY=Math.min(bounds.minTileY,point.y);
    bounds.maxTileX=Math.max(bounds.maxTileX,point.x);bounds.maxTileY=Math.max(bounds.maxTileY,point.y);
  }
  function recomputeStyleBounds(frame,styleIndex){
    requireFrame(frame);styleIndex=validStyleIndex(styleIndex);
    var keys=frame.styleTiles.get(styleIndex);
    if(!keys||keys.size===0){frame.styleBounds.delete(styleIndex);return null;}
    var bounds=null;
    keys.forEach(function(key){
      var point=parseTileKey(key);
      if(!bounds)bounds={minTileX:point.x,minTileY:point.y,maxTileX:point.x,maxTileY:point.y};
      else{
        bounds.minTileX=Math.min(bounds.minTileX,point.x);bounds.minTileY=Math.min(bounds.minTileY,point.y);
        bounds.maxTileX=Math.max(bounds.maxTileX,point.x);bounds.maxTileY=Math.max(bounds.maxTileY,point.y);
      }
    });
    frame.styleBounds.set(styleIndex,bounds);
    return bounds;
  }
  function ensureStyleChannel(frame,styleIndex,key){
    requireFrame(frame);styleIndex=validStyleIndex(styleIndex);
    if(!frame.indexToStyleId.has(styleIndex))throw new Error('Smart Raster v4 style index is not registered');
    var tile=ensureTile(frame,key),channel=tile.styleChannels.get(styleIndex);
    if(!channel){
      channel=new Uint16Array(TILE_SIZE*TILE_SIZE);
      tile.styleChannels.set(styleIndex,channel);tile.styleCounts.set(styleIndex,0);
    }
    return channel;
  }
  function removeEmptyChannel(frame,styleIndex,key,tile){
    tile.styleChannels.delete(styleIndex);tile.styleCounts.delete(styleIndex);
    var keys=frame.styleTiles.get(styleIndex);
    if(keys){keys.delete(key);if(keys.size===0)frame.styleTiles.delete(styleIndex);}
    recomputeStyleBounds(frame,styleIndex);
    if(tile.styleChannels.size===0)frame.tiles.delete(key);
  }
  function coverageFromUnit(value){
    var number=Number(value);
    if(!Number.isFinite(number))throw new TypeError('Smart Raster v4 unit coverage must be finite');
    return Math.round(Math.max(0,Math.min(1,number))*MAX_COVERAGE);
  }
  function coverage16(value){
    var number=Number(value);
    if(!Number.isFinite(number))throw new TypeError('Smart Raster v4 coverage must be finite');
    return Math.max(0,Math.min(MAX_COVERAGE,Math.round(number)));
  }
  function getCoverage(frame,styleIndex,x,y){
    styleIndex=validStyleIndex(styleIndex);
    var location=pixelLocation(frame,x,y),tile=frame.tiles.get(location.key);
    var channel=tile&&tile.styleChannels.get(styleIndex);
    return channel?channel[location.offset]:0;
  }
  function setCoverage(frame,styleIndex,x,y,coverage){
    styleIndex=validStyleIndex(styleIndex);
    var location=pixelLocation(frame,x,y),next=coverage16(coverage);
    var tile=frame.tiles.get(location.key),channel=tile&&tile.styleChannels.get(styleIndex);
    var previous=channel?channel[location.offset]:0;
    if(previous===next)return previous;
    if(!channel){
      if(next===0)return previous;
      channel=ensureStyleChannel(frame,styleIndex,location.key);tile=frame.tiles.get(location.key);
    }
    channel[location.offset]=next;
    var count=tile.styleCounts.get(styleIndex)||0;
    if(previous===0&&next!==0){count++;includeStyleTile(frame,styleIndex,location.key);}
    else if(previous!==0&&next===0)count--;
    tile.styleCounts.set(styleIndex,count);frame.dirtyTiles.add(location.key);
    if(count===0)removeEmptyChannel(frame,styleIndex,location.key,tile);
    return next;
  }
  function combineNormalCoverage(previous,source){
    return previous+Math.round((MAX_COVERAGE-previous)*source/MAX_COVERAGE);
  }
  function accumulateNormalCoverage(frame,styleIndex,x,y,sourceCoverage){
    var source=coverageFromUnit(sourceCoverage);
    if(source===0)return getCoverage(frame,styleIndex,x,y);
    var previous=getCoverage(frame,styleIndex,x,y);
    return setCoverage(frame,styleIndex,x,y,combineNormalCoverage(previous,source));
  }
  function recordNormalMask(frame,styleIndex,maskData,rect,strokeOpacity,onPixel){
    requireFrame(frame);styleIndex=validStyleIndex(styleIndex);
    if(!frame.indexToStyleId.has(styleIndex))throw new Error('Smart Raster v4 style index is not registered');
    var data=maskData&&maskData.data?maskData.data:maskData;
    if(!(data instanceof Uint8ClampedArray)&&!(data instanceof Uint8Array))throw new TypeError('Smart Raster v4 mask data is invalid');
    var x=Number(rect&&rect.x),y=Number(rect&&rect.y),width=Number(rect&&(rect.width==null?rect.w:rect.width)),height=Number(rect&&(rect.height==null?rect.h:rect.height));
    if(!Number.isInteger(x)||!Number.isInteger(y)||!Number.isInteger(width)||!Number.isInteger(height)||width<0||height<0||x<0||y<0||x+width>frame.width||y+height>frame.height)throw new RangeError('Smart Raster v4 mask rectangle is invalid');
    if(data.length!==width*height*4)throw new Error('Smart Raster v4 mask dimensions do not match its pixel data');
    var opacity=Math.max(0,Math.min(1,Number(strokeOpacity)));
    if(!Number.isFinite(opacity))throw new TypeError('Smart Raster v4 stroke opacity must be finite');
    var touchedPixels=0,touchedTiles=new Set();
    if(opacity===0)return {touchedPixels:0,touchedTiles:touchedTiles};
    for(var row=0;row<height;row++)for(var col=0;col<width;col++){
      var alpha=data[(row*width+col)*4+3];if(alpha===0)continue;
      var source=coverageFromUnit((alpha/255)*opacity);if(source===0)continue;
      var px=x+col,py=y+row,location=pixelLocation(frame,px,py);
      var tile=frame.tiles.get(location.key),channel=tile&&tile.styleChannels.get(styleIndex);
      var previous=channel?channel[location.offset]:0,next=combineNormalCoverage(previous,source);
      if(next===previous)continue;
      if(typeof onPixel==='function')onPixel({x:px,y:py,tileKey:location.key,tileOffset:location.offset,previous:previous,next:next,source:source});
      if(!channel){channel=ensureStyleChannel(frame,styleIndex,location.key);tile=frame.tiles.get(location.key);}
      channel[location.offset]=next;
      if(previous===0){
        tile.styleCounts.set(styleIndex,(tile.styleCounts.get(styleIndex)||0)+1);
        includeStyleTile(frame,styleIndex,location.key);
      }
      frame.dirtyTiles.add(location.key);touchedTiles.add(location.key);touchedPixels++;
    }
    return {touchedPixels:touchedPixels,touchedTiles:touchedTiles};
  }
  function reduceStyleCoverage(frame,styleIndex,x,y,eraseCoverage){
    requireFrame(frame);styleIndex=validStyleIndex(styleIndex);
    var erase=Math.max(0,Math.min(1,Number(eraseCoverage)));
    if(!Number.isFinite(erase))throw new TypeError('Smart Raster v4 erase coverage must be finite');
    var previous=getCoverage(frame,styleIndex,x,y);
    if(previous===0||erase===0)return {previous:previous,next:previous,changed:false,tileKey:pixelLocation(frame,x,y).key};
    var next=Math.round(previous*(1-erase)),key=pixelLocation(frame,x,y).key;
    setCoverage(frame,styleIndex,x,y,next);
    return {previous:previous,next:next,changed:next!==previous,tileKey:key};
  }
  function dirtyStyle(frame,styleIndex){
    requireFrame(frame);styleIndex=validStyleIndex(styleIndex);
    var keys=frame.styleTiles.get(styleIndex),changed=[];
    if(keys)keys.forEach(function(key){frame.dirtyTiles.add(key);changed.push(key);});
    return changed;
  }
  function styleUsage(frame,style){
    requireFrame(frame);
    var styleIndex=typeof style==='string'?getStyleIndex(frame,style):validStyleIndex(style);
    if(!styleIndex)return {registered:false,used:false,styleIndex:0,styleId:typeof style==='string'?style:null,tileKeys:[],tileCount:0,bounds:null,occupiedPixels:0,totalCoverage:0,equivalentOpaquePixels:0};
    var keys=frame.styleTiles.get(styleIndex),occupiedPixels=0,totalCoverage=0,tileKeys=keys?Array.from(keys):[];
    tileKeys.forEach(function(key){
      var tile=frame.tiles.get(key),channel=tile&&tile.styleChannels.get(styleIndex);
      if(!channel)return;
      occupiedPixels+=tile.styleCounts.get(styleIndex)||0;
      for(var i=0;i<channel.length;i++)totalCoverage+=channel[i];
    });
    return {registered:true,used:occupiedPixels>0,styleIndex:styleIndex,styleId:getStyleId(frame,styleIndex),tileKeys:tileKeys,tileCount:tileKeys.length,bounds:frame.styleBounds.get(styleIndex)||null,occupiedPixels:occupiedPixels,totalCoverage:totalCoverage,equivalentOpaquePixels:totalCoverage/MAX_COVERAGE};
  }  function removeStyleContributions(frame,styleIndex){
    requireFrame(frame);styleIndex=validStyleIndex(styleIndex);
    var keys=frame.styleTiles.get(styleIndex);
    if(!keys)return 0;
    var removed=0;
    Array.from(keys).forEach(function(key){
      var tile=frame.tiles.get(key);
      if(!tile||!tile.styleChannels.has(styleIndex))return;
      tile.styleChannels.delete(styleIndex);tile.styleCounts.delete(styleIndex);
      removed++;frame.dirtyTiles.add(key);
      if(tile.styleChannels.size===0)frame.tiles.delete(key);
    });
    frame.styleTiles.delete(styleIndex);frame.styleBounds.delete(styleIndex);
    return removed;
  }
  function consumeDirtyTiles(frame){
    requireFrame(frame);
    var keys=Array.from(frame.dirtyTiles);frame.dirtyTiles.clear();return keys;
  }
  function cloneFrame(frame){
    requireFrame(frame);
    var copy=createFrame(frame.width,frame.height);copy.lifecycle=cloneLifecycle(frame.lifecycle);copy.nextStyleIndex=frame.nextStyleIndex;
    frame.styleIdToIndex.forEach(function(index,id){copy.styleIdToIndex.set(id,index);});
    frame.indexToStyleId.forEach(function(id,index){copy.indexToStyleId.set(index,id);});
    frame.tiles.forEach(function(tile,key){
      var tileCopy=createTile();
      tile.styleChannels.forEach(function(channel,index){tileCopy.styleChannels.set(index,channel.slice());});
      tile.styleCounts.forEach(function(count,index){tileCopy.styleCounts.set(index,count);});
      copy.tiles.set(key,tileCopy);
    });
    frame.styleTiles.forEach(function(keys,index){copy.styleTiles.set(index,new Set(keys));});
    frame.styleBounds.forEach(function(bounds,index){copy.styleBounds.set(index,Object.assign({},bounds));});
    frame.dirtyTiles.forEach(function(key){copy.dirtyTiles.add(key);});
    return copy;
  }
  function validateFrame(frame){
    requireFrame(frame);
    positiveInteger(frame.width,'Smart Raster v4 frame width');positiveInteger(frame.height,'Smart Raster v4 frame height');
    if(frame.coverageSemantics!==COVERAGE_SEMANTICS)throw new Error('Smart Raster v4 coverage semantics are invalid');
    if(frame.lifecycle.state!=='complete'&&frame.lifecycle.state!=='incomplete')throw new Error('Smart Raster v4 lifecycle state is invalid');
    if(frame.lifecycle.state==='complete'&&frame.lifecycle.incompleteReasons.size)throw new Error('Smart Raster v4 complete frame has incomplete reasons');
    if(frame.lifecycle.authorityEligible&&frame.lifecycle.state!=='complete')throw new Error('Smart Raster v4 incomplete frame cannot be authoritative');
    frame.styleIdToIndex.forEach(function(index,id){
      validStyleId(id);validStyleIndex(index);
      if(frame.indexToStyleId.get(index)!==id)throw new Error('Smart Raster v4 style maps are inconsistent');
    });
    frame.tiles.forEach(function(tile,key){
      var point=parseTileKey(key);
      if(point.x*TILE_SIZE>=frame.width||point.y*TILE_SIZE>=frame.height)throw new Error('Smart Raster v4 tile is outside the frame');
      if(!tile||!(tile.styleChannels instanceof Map)||!(tile.styleCounts instanceof Map))throw new Error('Smart Raster v4 tile is malformed');
      if(tile.styleChannels.size===0||tile.styleCounts.size!==tile.styleChannels.size)throw new Error('Smart Raster v4 tile occupancy metadata is inconsistent');
      tile.styleChannels.forEach(function(channel,index){
        validStyleIndex(index);
        if(!frame.indexToStyleId.has(index))throw new Error('Smart Raster v4 channel uses an unknown style');
        if(!(channel instanceof Uint16Array)||channel.length!==TILE_SIZE*TILE_SIZE)throw new Error('Smart Raster v4 coverage channel is malformed');
        var count=0;
        for(var i=0;i<channel.length;i++)if(channel[i]!==0)count++;
        if(count===0||tile.styleCounts.get(index)!==count)throw new Error('Smart Raster v4 channel occupancy is inconsistent');
        var keys=frame.styleTiles.get(index);
        if(!keys||!keys.has(key))throw new Error('Smart Raster v4 inverted style index is inconsistent');
      });
    });
    frame.styleTiles.forEach(function(keys,index){
      validStyleIndex(index);
      if(!frame.indexToStyleId.has(index)||!(keys instanceof Set)||keys.size===0)throw new Error('Smart Raster v4 inverted style index is malformed');
      keys.forEach(function(key){
        var tile=frame.tiles.get(key);
        if(!tile||!tile.styleChannels.has(index))throw new Error('Smart Raster v4 inverted style index references a missing channel');
      });
    });
    frame.indexToStyleId.forEach(function(id,index){
      validStyleIndex(index);validStyleId(id);
      if(frame.styleIdToIndex.get(id)!==index)throw new Error('Smart Raster v4 reverse style map is inconsistent');
    });
    frame.tiles.forEach(function(tile){if(tile.styleChannels.size===0)throw new Error('Smart Raster v4 contains an empty tile');});
    frame.dirtyTiles.forEach(function(key){parseTileKey(key);});
    return true;
  }

  function resizeFrame(frame,width,height){
    requireFrame(frame);width=positiveInteger(width,'Smart Raster v4 resized width');height=positiveInteger(height,'Smart Raster v4 resized height');
    var resized=createFrame(width,height);resized.lifecycle=cloneLifecycle(frame.lifecycle);resized.nextStyleIndex=frame.nextStyleIndex;
    frame.styleIdToIndex.forEach(function(index,id){resized.styleIdToIndex.set(id,index);});frame.indexToStyleId.forEach(function(id,index){resized.indexToStyleId.set(index,id);});
    var dx=Math.round((width-frame.width)/2),dy=Math.round((height-frame.height)/2);
    frame.tiles.forEach(function(tile,key){var point=parseTileKey(key),baseX=point.x*TILE_SIZE,baseY=point.y*TILE_SIZE;tile.styleChannels.forEach(function(channel,index){for(var offset=0;offset<channel.length;offset++){var coverage=channel[offset];if(!coverage)continue;var x=baseX+(offset%TILE_SIZE),y=baseY+Math.floor(offset/TILE_SIZE),nx=x+dx,ny=y+dy;if(x<frame.width&&y<frame.height&&nx>=0&&ny>=0&&nx<width&&ny<height)setCoverage(resized,index,nx,ny,coverage);}});});
    resized.tiles.forEach(function(tile,key){resized.dirtyTiles.add(key);});validateFrame(resized);return resized;
  }  var SERIALIZATION_VERSION=4;
  var FORMAT_REVISION=1;
  function encodeCoverage(channel){
    var bytes=new Uint8Array(channel.buffer,channel.byteOffset,channel.byteLength),binary='';
    for(var start=0;start<bytes.length;start+=0x8000)binary+=String.fromCharCode.apply(null,bytes.subarray(start,start+0x8000));
    if(typeof btoa==='function')return btoa(binary);
    if(typeof Buffer!=='undefined')return Buffer.from(bytes).toString('base64');
    throw new Error('Smart Raster v4 base64 encoder is unavailable');
  }
  function decodeCoverage(encoded){
    if(typeof encoded!=='string')throw new TypeError('Smart Raster v4 coverage must be base64 text');
    var bytes;
    try{
      if(typeof atob==='function'){var binary=atob(encoded);bytes=new Uint8Array(binary.length);for(var i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);}
      else if(typeof Buffer!=='undefined')bytes=new Uint8Array(Buffer.from(encoded,'base64'));
      else throw new Error('base64 decoder unavailable');
    }catch(error){throw new Error('Smart Raster v4 coverage base64 is invalid');}
    if(bytes.byteLength!==TILE_SIZE*TILE_SIZE*2)throw new Error('Smart Raster v4 coverage array length is invalid');
    var channel=new Uint16Array(TILE_SIZE*TILE_SIZE),nonzero=0;
    for(var p=0,o=0;p<channel.length;p++,o+=2){channel[p]=bytes[o]|(bytes[o+1]<<8);if(channel[p])nonzero++;}
    if(nonzero===0)throw new Error('Smart Raster v4 serialized channel is empty');
    return channel;
  }
  function stringSet(values,label){
    if(!Array.isArray(values))throw new TypeError(label+' must be an array');
    var set=new Set();values.forEach(function(value){if(typeof value!=='string'||!value)throw new TypeError(label+' contains an invalid value');if(set.has(value))throw new Error(label+' contains duplicates');set.add(value);});return set;
  }
  function serializeFrame(frame){
    requireFrame(frame);validateFrame(frame);
    var used=new Set();frame.tiles.forEach(function(tile){tile.styleChannels.forEach(function(channel,index){used.add(index);});});
    var styles=Array.from(used).sort(function(a,b){return a-b;}).map(function(index){var id=frame.indexToStyleId.get(index);if(!id)throw new Error('Smart Raster v4 used style has no stable ID');return {index:index,id:id};});
    var tiles=Array.from(frame.tiles.entries()).sort(function(a,b){var ap=parseTileKey(a[0]),bp=parseTileKey(b[0]);return ap.y-bp.y||ap.x-bp.x;}).map(function(pair){
      var point=parseTileKey(pair[0]),channels=[];pair[1].styleChannels.forEach(function(channel,index){channels.push({styleIndex:index,coverage:encodeCoverage(channel)});});channels.sort(function(a,b){return a.styleIndex-b.styleIndex;});
      return {x:point.x,y:point.y,channels:channels};
    });
    var lifecycle=frame.lifecycle;
    return {version:SERIALIZATION_VERSION,formatRevision:FORMAT_REVISION,tileSize:TILE_SIZE,width:frame.width,height:frame.height,coverageEncoding:'uint16-le-base64',frameType:lifecycle.role,nextStyleIndex:frame.nextStyleIndex,styles:styles,tiles:tiles,lifecycle:{role:lifecycle.role,state:lifecycle.state,authorityEligible:!!lifecycle.authorityEligible,supportedModes:Array.from(lifecycle.supportedModes),observedModes:Array.from(lifecycle.observedModes),supportedEdits:Array.from(lifecycle.supportedEdits),observedEdits:Array.from(lifecycle.observedEdits),incompleteReasons:Array.from(lifecycle.incompleteReasons)}};
  }
  function deserializeFrame(saved){
    if(!saved||typeof saved!=='object')throw new TypeError('Smart Raster v4 serialized frame is invalid');
    if(saved.version!==SERIALIZATION_VERSION||saved.formatRevision!==FORMAT_REVISION)throw new Error('Unsupported Smart Raster v4 serialization version');
    if(saved.tileSize!==TILE_SIZE)throw new Error('Unsupported Smart Raster v4 tile size');
    if(saved.coverageEncoding!=='uint16-le-base64')throw new Error('Unsupported Smart Raster v4 coverage encoding');
    var width=positiveInteger(saved.width,'Smart Raster v4 serialized width'),height=positiveInteger(saved.height,'Smart Raster v4 serialized height');
    if(saved.frameType!=='v4-native'&&saved.frameType!=='shadow-diagnostic')throw new Error('Smart Raster v4 frame type is invalid');
    if(!Array.isArray(saved.styles)||!Array.isArray(saved.tiles))throw new TypeError('Smart Raster v4 styles and tiles must be arrays');
    var frame=createFrame(width,height,{role:saved.frameType==='v4-native'?'v4-native-empty':undefined}),styleIndices=new Set(),styleIds=new Set();
    frame.styleIdToIndex.clear();frame.indexToStyleId.clear();
    saved.styles.forEach(function(style){var index=validStyleIndex(style&&style.index),id=validStyleId(style&&style.id);if(styleIndices.has(index)||styleIds.has(id))throw new Error('Smart Raster v4 contains duplicate style mappings');styleIndices.add(index);styleIds.add(id);frame.styleIdToIndex.set(id,index);frame.indexToStyleId.set(index,id);});
    var next=Number(saved.nextStyleIndex);if(!Number.isInteger(next)||next<1||next>MAX_STYLE_INDEX+1||Array.from(styleIndices).some(function(index){return index>=next;}))throw new Error('Smart Raster v4 next style index is invalid');frame.nextStyleIndex=next;
    var tileKeys=new Set();saved.tiles.forEach(function(savedTile){
      var key=tileKey(savedTile&&savedTile.x,savedTile&&savedTile.y),point=parseTileKey(key);if(point.x*TILE_SIZE>=width||point.y*TILE_SIZE>=height)throw new Error('Smart Raster v4 serialized tile is outside the frame');if(tileKeys.has(key))throw new Error('Smart Raster v4 contains duplicate tiles');tileKeys.add(key);
      if(!Array.isArray(savedTile.channels)||savedTile.channels.length===0)throw new Error('Smart Raster v4 serialized tile has no channels');var tile=createTile(),channelIndices=new Set();
      savedTile.channels.forEach(function(savedChannel){var index=validStyleIndex(savedChannel&&savedChannel.styleIndex);if(!styleIndices.has(index))throw new Error('Smart Raster v4 channel references an unknown style');if(channelIndices.has(index))throw new Error('Smart Raster v4 tile contains duplicate channels');channelIndices.add(index);var channel=decodeCoverage(savedChannel.coverage),count=0;for(var i=0;i<channel.length;i++)if(channel[i])count++;tile.styleChannels.set(index,channel);tile.styleCounts.set(index,count);});frame.tiles.set(key,tile);
    });
    var lifecycle=saved.lifecycle;if(!lifecycle||typeof lifecycle!=='object'||lifecycle.role!==saved.frameType||(lifecycle.state!=='complete'&&lifecycle.state!=='incomplete')||typeof lifecycle.authorityEligible!=='boolean')throw new Error('Smart Raster v4 lifecycle metadata is invalid');
    frame.lifecycle={role:lifecycle.role,state:lifecycle.state,authorityEligible:lifecycle.authorityEligible,supportedModes:stringSet(lifecycle.supportedModes,'supported modes'),observedModes:stringSet(lifecycle.observedModes,'observed modes'),supportedEdits:stringSet(lifecycle.supportedEdits,'supported edits'),observedEdits:stringSet(lifecycle.observedEdits,'observed edits'),incompleteReasons:stringSet(lifecycle.incompleteReasons,'incompleteness reasons')};
    frame.tiles.forEach(function(tile,key){tile.styleChannels.forEach(function(channel,index){includeStyleTile(frame,index,key);});});frame.styleTiles.forEach(function(keys,index){recomputeStyleBounds(frame,index);});
    frame.tiles.forEach(function(tile,key){frame.dirtyTiles.add(key);});validateFrame(frame);return frame;
  }  var api=Object.freeze({
    VERSION:VERSION,SERIALIZATION_VERSION:SERIALIZATION_VERSION,FORMAT_REVISION:FORMAT_REVISION,TILE_SIZE:TILE_SIZE,MAX_COVERAGE:MAX_COVERAGE,COVERAGE_SEMANTICS:COVERAGE_SEMANTICS,coverageFromUnit:coverageFromUnit,
    createFrame:createFrame,createShadowFrame:createShadowFrame,createNativeFrame:createNativeFrame,isFrame:isFrame,validateFrame:validateFrame,cloneFrame:cloneFrame,
    markFrameIncomplete:markFrameIncomplete,noteBlendMode:noteBlendMode,noteEdit:noteEdit,isAuthorityEligible:isAuthorityEligible,lifecycleSummary:lifecycleSummary,
    ensureStyleIndex:ensureStyleIndex,getStyleIndex:getStyleIndex,getStyleId:getStyleId,
    tileKey:tileKey,parseTileKey:parseTileKey,pixelLocation:pixelLocation,
    getCoverage:getCoverage,setCoverage:setCoverage,
    accumulateNormalCoverage:accumulateNormalCoverage,recordNormalMask:recordNormalMask,reduceStyleCoverage:reduceStyleCoverage,dirtyStyle:dirtyStyle,styleUsage:styleUsage,removeStyleContributions:removeStyleContributions,
    recomputeStyleBounds:recomputeStyleBounds,consumeDirtyTiles:consumeDirtyTiles,resizeFrame:resizeFrame,serializeFrame:serializeFrame,deserializeFrame:deserializeFrame
  });
  root.SmartRasterV4=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
