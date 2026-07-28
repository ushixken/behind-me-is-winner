(function(root){
  'use strict';

  var v4=root.SmartRasterV4;
  if(!v4)return;

  var TILE_SIZE=v4.TILE_SIZE;
  var framesByLayer=new WeakMap();
  var trackedLayers=new Set();
  var stateByFrame=new WeakMap();
  var legacyStateByLayer=new WeakMap();
  var historyUndo=[];
  var historyRedo=[];
  var HISTORY_LIMIT=40;
  var nextCommandId=1;
  var liveEraserSession=null;
  var palettePriorityCache=null;
  var resolvedStyleCache=new Map();
  var compositionVersion=0;
  var documentReport={lastOperation:null,operations:[],validationErrors:[]};
  var serializationReport={serializationVersion:v4.SERIALIZATION_VERSION,formatRevision:v4.FORMAT_REVISION,serializedFrameCount:0,loadedFrameCount:0,rejectedFrames:[],validationWarnings:[],legacyLayers:0,serializedBytes:0,rebuiltIndexes:0,lifecycleStates:{}};

  function currentLayers(){return typeof layers!=='undefined'&&Array.isArray(layers)?layers:null;}
  function shadowFrames(layer){
    trackedLayers.add(layer);
    var frames=framesByLayer.get(layer);
    if(!frames){frames=new Map();framesByLayer.set(layer,frames);}
    return frames;
  }
  function createState(frame,layer,layerIndex,frameIndex){
    var state={
      frame:frame,layer:layer,layerIndex:layerIndex,frameIndex:frameIndex,
      sequence:0,tileOrder:new Map(),compositeTiles:new Map(),ownerTiles:new Map(),
      comparableTiles:new Map(),comparisons:new Map(),errors:new Map(),renderStats:{renderedTileCount:0,recomposedTiles:[],skippedTiles:[],cacheRebuilds:0,renderTimeMs:0,lastRenderAt:0}
    };
    stateByFrame.set(frame,state);
    return state;
  }
  function ensureShadowFrame(layer,layerIndex,frameIndex,width,height){
    var frames=shadowFrames(layer),frame=frames.get(frameIndex);
    if(!v4.isFrame(frame)||frame.width!==width||frame.height!==height){
      frame=layer&&layer.smartRasterV4Native?v4.createNativeFrame(width,height):v4.createShadowFrame(width,height);frames.set(frameIndex,frame);
      createState(frame,layer,layerIndex,frameIndex);
    }
    var state=stateByFrame.get(frame)||createState(frame,layer,layerIndex,frameIndex);
    state.layerIndex=layerIndex;state.frameIndex=frameIndex;
    return {frame:frame,state:state};
  }
  function ensureComparableTile(state,key){
    var mask=state.comparableTiles.get(key);
    if(!mask){mask=new Uint8Array(TILE_SIZE*TILE_SIZE);state.comparableTiles.set(key,mask);}
    return mask;
  }
  function updateComparablePixel(state,commit,pixel){
    if(!commit.beforeData)return;
    var local=((pixel.y-commit.rect.y)*commit.rect.width+(pixel.x-commit.rect.x))*4;
    if(local<0||local+3>=commit.beforeData.length)return;
    var comparable=ensureComparableTile(state,pixel.tileKey);
    if(comparable[pixel.tileOffset]===0&&commit.beforeData[local+3]===0)comparable[pixel.tileOffset]=1;
  }
  function updateTileOrder(state,styleIndex,touchedTiles){
    state.sequence++;
    touchedTiles.forEach(function(key){
      var order=state.tileOrder.get(key);
      if(!order){order={runs:[],seen:new Set(),unsupported:false,reasons:[]};state.tileOrder.set(key,order);}
      var last=order.runs.length?order.runs[order.runs.length-1]:0;
      if(last===styleIndex)return;
      if(order.seen.has(styleIndex)){
        order.unsupported=true;
        if(order.reasons.indexOf('interleaved-style-chronology')===-1)order.reasons.push('interleaved-style-chronology');
      }else order.seen.add(styleIndex);
      order.runs.push(styleIndex);
    });
  }
  function resolveStyle(styleId){
    var palette=root.PaletteDocker;
    var style=palette&&typeof palette.findAdvancedStyleById==='function'?palette.findAdvancedStyleById(styleId):null;
    if(!style||style.type!=='style'||!Array.isArray(style.rgba)||style.rgba.length<4)throw new Error('Smart Raster v4 style is missing or non-renderable: '+styleId);
    var signature=style.rgba.slice(0,4).join(','),cached=resolvedStyleCache.get(styleId);if(cached&&cached.signature===signature)return cached.value;
    var rgba=style.rgba.slice(0,4).map(function(value){return Math.max(0,Math.min(255,Math.round(Number(value)||0)));});
    var value={id:styleId,rgba:rgba,colorEncoding:'straight-rgba8'};resolvedStyleCache.set(styleId,{signature:signature,value:value});return value;
  }
  function palettePriority(){
    if(palettePriorityCache)return palettePriorityCache;
    var palette=root.PaletteDocker,ids=palette&&typeof palette.getAdvancedStyleOrder==='function'?palette.getAdvancedStyleOrder():[],priority=new Map();ids.forEach(function(id,index){priority.set(String(id),index);});
    palettePriorityCache={ids:ids,priority:priority};return palettePriorityCache;
  }
  function orderedContributors(frame,state,key,tile){
    var priority=palettePriority().priority,contributors=[];tile.styleChannels.forEach(function(channel,index){var styleId=v4.getStyleId(frame,index);if(!styleId)throw new Error('Smart Raster v4 style index has no stable ID: '+index);if(!priority.has(styleId))throw new Error('Smart Raster v4 style is absent from the Advanced Palette: '+styleId);contributors.push({styleIndex:index,style:resolveStyle(styleId),coverage:channel,priority:priority.get(styleId)});});
    var order=state.tileOrder.get(key),reasons=[],chronology=order?order.runs.filter(function(index,pos,list){return list.indexOf(index)===pos&&tile.styleChannels.has(index);}):[];
    if(state.layer&&state.layer.renderMode==='style-layering')contributors.sort(function(a,b){return b.priority-a.priority;});
    else{
      var chronologicalRank=new Map();chronology.forEach(function(index,rank){chronologicalRank.set(index,rank);});
      contributors.sort(function(a,b){var ar=chronologicalRank.has(a.styleIndex)?chronologicalRank.get(a.styleIndex):Number.MAX_SAFE_INTEGER,br=chronologicalRank.has(b.styleIndex)?chronologicalRank.get(b.styleIndex):Number.MAX_SAFE_INTEGER;return ar-br||b.priority-a.priority;});
    }
    var rendered=contributors.map(function(item){return item.styleIndex;});
    if(!order)reasons.push('missing-tile-chronology');
    else if(order.unsupported)reasons=reasons.concat(order.reasons);
    if(state.layer&&state.layer.renderMode==='style-layering'&&(chronology.length!==rendered.length||chronology.some(function(index,pos){return index!==rendered[pos];})))reasons.push('palette-order-differs-from-v3-chronology');
    return {contributors:contributors,supported:reasons.length===0,reasons:Array.from(new Set(reasons))};
  }  function tileDimensions(frame,key){
    var point=v4.parseTileKey(key),x=point.x*TILE_SIZE,y=point.y*TILE_SIZE;
    return {x:x,y:y,width:Math.min(TILE_SIZE,frame.width-x),height:Math.min(TILE_SIZE,frame.height-y)};
  }
  function compositeTile(frame,state,key,tile,scratch,orderedOverride){
    var dimensions=tileDimensions(frame,key),ordered=orderedOverride||orderedContributors(frame,state,key,tile),pixels=dimensions.width*dimensions.height;
    scratch=scratch||{};
    var premul=scratch.premul;if(!(premul instanceof Float32Array)||premul.length<pixels*4)premul=scratch.premul=new Float32Array(pixels*4);else premul.fill(0,0,pixels*4);
    var owner=scratch.owner;if(!(owner instanceof Uint16Array)||owner.length!==TILE_SIZE*TILE_SIZE)owner=scratch.owner=new Uint16Array(TILE_SIZE*TILE_SIZE);else owner.fill(0);
    ordered.contributors.forEach(function(contributor){
      var rgba=contributor.style.rgba,styleAlpha=rgba[3]/255,red=rgba[0]/255,green=rgba[1]/255,blue=rgba[2]/255,coverage=contributor.coverage;
      for(var y=0;y<dimensions.height;y++)for(var x=0;x<dimensions.width;x++){
        var tileOffset=y*TILE_SIZE+x,c=coverage[tileOffset]/v4.MAX_COVERAGE,sourceAlpha=c*styleAlpha;if(sourceAlpha<=0)continue;
        var local=(y*dimensions.width+x)*4,destAlpha=premul[local+3],remaining=1-sourceAlpha;
        premul[local]=red*sourceAlpha+premul[local]*remaining;premul[local+1]=green*sourceAlpha+premul[local+1]*remaining;premul[local+2]=blue*sourceAlpha+premul[local+2]*remaining;premul[local+3]=sourceAlpha+destAlpha*remaining;owner[tileOffset]=contributor.styleIndex;
      }
    });
    var rgbaTile=scratch.rgba;if(!(rgbaTile instanceof Uint8ClampedArray)||rgbaTile.length!==TILE_SIZE*TILE_SIZE*4)rgbaTile=scratch.rgba=new Uint8ClampedArray(TILE_SIZE*TILE_SIZE*4);else rgbaTile.fill(0);
    for(var y=0;y<dimensions.height;y++)for(var x=0;x<dimensions.width;x++){
      var local=(y*dimensions.width+x)*4,tileOffset=(y*TILE_SIZE+x)*4,alpha=premul[local+3];
      if(alpha>0){rgbaTile[tileOffset]=Math.round(Math.max(0,Math.min(1,premul[local]/alpha))*255);rgbaTile[tileOffset+1]=Math.round(Math.max(0,Math.min(1,premul[local+1]/alpha))*255);rgbaTile[tileOffset+2]=Math.round(Math.max(0,Math.min(1,premul[local+2]/alpha))*255);rgbaTile[tileOffset+3]=Math.round(Math.max(0,Math.min(1,alpha))*255);}
    }
    var result=scratch.result||{};scratch.result=result;result.rgba=rgbaTile;result.owner=owner;result.dimensions=dimensions;result.supported=ordered.supported;result.reasons=ordered.reasons;result.order=ordered.contributors.map(function(item){return item.styleIndex;});return result;
  }  function authoritativeCanvas(state){
    if(typeof curLayer!=='undefined'&&typeof curFrame!=='undefined'&&state.layerIndex===curLayer&&state.frameIndex===curFrame&&typeof activeC!=='undefined')return activeC;
    return state.layer&&state.layer.frames&&state.layer.frames[state.frameIndex]||null;
  }
  function compareTile(state,key,rendered){
    var canvas=authoritativeCanvas(state);
    if(!canvas||typeof canvas.getContext!=='function')throw new Error('Smart Raster v3 authoritative canvas is unavailable');
    var dimensions=rendered.dimensions;
    var v3=canvas.getContext('2d',{willReadFrequently:true}).getImageData(dimensions.x,dimensions.y,dimensions.width,dimensions.height).data;
    var comparable=state.comparableTiles.get(key),compared=0,mismatched=0,totalDelta=0,maxDelta=0,firstMismatch=null;
    for(var y=0;y<dimensions.height;y++)for(var x=0;x<dimensions.width;x++){
      var tilePixel=y*TILE_SIZE+x;
      if(!comparable||comparable[tilePixel]!==1)continue;
      compared++;
      var local=(y*dimensions.width+x)*4,shadow=tilePixel*4,pixelMismatch=false,deltas=[];
      for(var channel=0;channel<4;channel++){
        var delta=Math.abs(v3[local+channel]-rendered.rgba[shadow+channel]);
        deltas.push(delta);totalDelta+=delta;maxDelta=Math.max(maxDelta,delta);if(delta!==0)pixelMismatch=true;
      }
      if(pixelMismatch){
        mismatched++;
        if(!firstMismatch)firstMismatch={x:dimensions.x+x,y:dimensions.y+y,v3:Array.from(v3.slice(local,local+4)),v4:Array.from(rendered.rgba.slice(shadow,shadow+4)),delta:deltas};
      }
    }
    return {
      tileKey:key,supported:rendered.supported,unsupportedReasons:rendered.reasons.slice(),
      comparedPixels:compared,mismatchedPixels:mismatched,matchedPixels:compared-mismatched,
      maxChannelDelta:maxDelta,totalAbsoluteDelta:totalDelta,
      meanAbsoluteDelta:compared?totalDelta/(compared*4):0,firstMismatch:firstMismatch,
      order:rendered.order.slice()
    };
  }
  function composeDirtyTiles(frame,state,forceVisible){
    var started=typeof performance!=='undefined'&&performance.now?performance.now():Date.now(),completed=[],failed=[],skipped=[],cacheRebuilds=0;
    Array.from(frame.dirtyTiles).forEach(function(key){
      try{
        var tile=frame.tiles.get(key);
        if(!tile){state.compositeTiles.delete(key);state.ownerTiles.delete(key);state.comparisons.delete(key);state.errors.delete(key);if(forceVisible||state.layer&&state.layer.renderMode==='style-layering'){var empty={rgba:new Uint8ClampedArray(TILE_SIZE*TILE_SIZE*4),owner:new Uint16Array(TILE_SIZE*TILE_SIZE),dimensions:tileDimensions(frame,key)};if(!writeVisibleTile(frame,state,key,empty))throw new Error('Smart Raster empty tile could not be committed');}frame.dirtyTiles.delete(key);skipped.push(key);cacheRebuilds++;return;}
        var rendered=compositeTile(frame,state,key,tile),comparison;
        state.compositeTiles.set(key,rendered.rgba);state.ownerTiles.set(key,rendered.owner);
        try{comparison=compareTile(state,key,rendered);}catch(compareError){comparison={tileKey:key,supported:false,unsupportedReasons:['comparison-unavailable'],comparedPixels:0,mismatchedPixels:0,matchedPixels:0,maxChannelDelta:0,totalAbsoluteDelta:0,meanAbsoluteDelta:0,firstMismatch:null,order:rendered.order.slice(),comparisonError:compareError.message||String(compareError)};}
        state.comparisons.set(key,comparison);state.errors.delete(key);
        if((forceVisible||state.layer&&state.layer.renderMode==='style-layering')&&!writeVisibleTile(frame,state,key,rendered))throw new Error('Smart Raster visible tile could not be committed');frame.dirtyTiles.delete(key);completed.push(key);cacheRebuilds++;
      }catch(error){state.errors.set(key,{tileKey:key,message:error&&error.message?error.message:String(error)});failed.push(key);}
    });
    var ended=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();state.renderStats={renderedTileCount:completed.length,dirtyTileCount:frame.dirtyTiles.size,renderTimeMs:ended-started,recomposedTiles:completed.slice(),skippedTiles:skipped.slice(),failedTiles:failed.slice(),cacheRebuilds:cacheRebuilds,lastRenderAt:Date.now()};
    return {completed:completed,failed:failed,skipped:skipped,renderTimeMs:ended-started,cacheRebuilds:cacheRebuilds};
  }  function cloneTile(tile){
    if(!tile)return null;
    var copy={styleChannels:new Map(),styleCounts:new Map()};
    tile.styleChannels.forEach(function(channel,index){copy.styleChannels.set(index,channel.slice());});
    tile.styleCounts.forEach(function(count,index){copy.styleCounts.set(index,count);});
    return copy;
  }
  function cloneOrder(order){return order?{runs:order.runs.slice(),seen:new Set(order.seen),unsupported:!!order.unsupported,reasons:order.reasons.slice()}:null;}
  function snapshotMetadata(frame){
    var lifecycle=frame.lifecycle;
    return {styleIdToIndex:new Map(frame.styleIdToIndex),indexToStyleId:new Map(frame.indexToStyleId),nextStyleIndex:frame.nextStyleIndex,lifecycle:{role:lifecycle.role,state:lifecycle.state,authorityEligible:lifecycle.authorityEligible,supportedModes:new Set(lifecycle.supportedModes),observedModes:new Set(lifecycle.observedModes),supportedEdits:new Set(lifecycle.supportedEdits),observedEdits:new Set(lifecycle.observedEdits),incompleteReasons:new Set(lifecycle.incompleteReasons)}};
  }
  function restoreMetadata(frame,snapshot){
    frame.styleIdToIndex=new Map(snapshot.styleIdToIndex);frame.indexToStyleId=new Map(snapshot.indexToStyleId);frame.nextStyleIndex=snapshot.nextStyleIndex;
    frame.lifecycle={role:snapshot.lifecycle.role,state:snapshot.lifecycle.state,authorityEligible:snapshot.lifecycle.authorityEligible,supportedModes:new Set(snapshot.lifecycle.supportedModes),observedModes:new Set(snapshot.lifecycle.observedModes),supportedEdits:new Set(snapshot.lifecycle.supportedEdits),observedEdits:new Set(snapshot.lifecycle.observedEdits),incompleteReasons:new Set(snapshot.lifecycle.incompleteReasons)};
  }
  function rebuildDerived(frame){
    frame.styleTiles.clear();frame.styleBounds.clear();
    Array.from(frame.tiles.entries()).forEach(function(pair){
      var key=pair[0],tile=pair[1],point=v4.parseTileKey(key);
      Array.from(tile.styleChannels.entries()).forEach(function(entry){
        var index=entry[0],channel=entry[1],count=0;for(var i=0;i<channel.length;i++)if(channel[i]!==0)count++;
        if(count===0){tile.styleChannels.delete(index);tile.styleCounts.delete(index);return;}
        tile.styleCounts.set(index,count);
        var keys=frame.styleTiles.get(index);if(!keys){keys=new Set();frame.styleTiles.set(index,keys);}keys.add(key);
        var bounds=frame.styleBounds.get(index);
        if(!bounds)frame.styleBounds.set(index,{minTileX:point.x,minTileY:point.y,maxTileX:point.x,maxTileY:point.y});
        else{bounds.minTileX=Math.min(bounds.minTileX,point.x);bounds.minTileY=Math.min(bounds.minTileY,point.y);bounds.maxTileX=Math.max(bounds.maxTileX,point.x);bounds.maxTileY=Math.max(bounds.maxTileY,point.y);}
      });
      if(tile.styleChannels.size===0)frame.tiles.delete(key);
    });
  }
  function createHistoryCommand(operation){return {id:nextCommandId++,operation:operation,createdAt:Date.now(),entries:[],integrated:false,status:'capturing',failure:null};}
  function createHistoryEntry(frame,state,layer,layerIndex,frameIndex){return {frame:frame,state:state,layer:layer,layerIndex:layerIndex,frameIndex:frameIndex,keys:new Set(),beforeTiles:new Map(),afterTiles:new Map(),beforeAux:new Map(),afterAux:new Map(),beforeMetadata:snapshotMetadata(frame),afterMetadata:null,patchMode:null,styleIndex:0,beforeChannels:new Map(),afterChannels:new Map()};}
  function captureBefore(entry,key){
    if(entry.beforeTiles.has(key))return;
    entry.keys.add(key);entry.beforeTiles.set(key,cloneTile(entry.frame.tiles.get(key)));
    entry.beforeAux.set(key,{order:cloneOrder(entry.state.tileOrder.get(key)),comparable:entry.state.comparableTiles.has(key)?entry.state.comparableTiles.get(key).slice():null});
  }
  function captureAfter(entry){
    entry.keys.forEach(function(key){entry.afterTiles.set(key,cloneTile(entry.frame.tiles.get(key)));entry.afterAux.set(key,{order:cloneOrder(entry.state.tileOrder.get(key)),comparable:entry.state.comparableTiles.has(key)?entry.state.comparableTiles.get(key).slice():null});});
    entry.afterMetadata=snapshotMetadata(entry.frame);
  }
  function pushHistory(command){
    if(!command.entries.length)return null;
    command.status='ready';historyUndo.push(command);if(historyUndo.length>HISTORY_LIMIT)historyUndo.shift();historyRedo.length=0;return command;
  }
  function failHistoryCapture(command,error){
    command.status='failed';command.failure={direction:'capture',message:error&&error.message?error.message:String(error)};
    command.entries.forEach(function(entry){v4.markFrameIncomplete(entry.frame,'undo-capture-failed');});
    root.__smartRasterV4LastHistoryError=command.failure;
  }
  function restoreAux(state,key,snapshot){
    if(snapshot&&snapshot.order)state.tileOrder.set(key,cloneOrder(snapshot.order));else state.tileOrder.delete(key);
    if(snapshot&&snapshot.comparable)state.comparableTiles.set(key,snapshot.comparable.slice());else state.comparableTiles.delete(key);
  }
  function restoreStyleChannelEntry(entry,direction,metadata){
    var frame=entry.frame,state=entry.state,target=direction==='undo'?entry.beforeChannels:entry.afterChannels,current=new Map(),currentMetadata=snapshotMetadata(frame);
    entry.keys.forEach(function(key){var tile=frame.tiles.get(key),channel=tile&&tile.styleChannels.get(entry.styleIndex);current.set(key,channel?channel.slice():null);});
    try{
      if(root.__smartRasterV4ForceHistoryFailure)throw new Error('Forced Smart Raster v4 history failure');
      target.forEach(function(channel,key){var tile=frame.tiles.get(key);if(channel){if(!tile){tile={styleChannels:new Map(),styleCounts:new Map()};frame.tiles.set(key,tile);}tile.styleChannels.set(entry.styleIndex,channel.slice());}else if(tile){tile.styleChannels.delete(entry.styleIndex);tile.styleCounts.delete(entry.styleIndex);if(!tile.styleChannels.size)frame.tiles.delete(key);}});
      restoreMetadata(frame,metadata);rebuildDerived(frame);invalidateTiles(frame,entry.keys,true);v4.validateFrame(frame);return true;
    }catch(error){
      current.forEach(function(channel,key){var tile=frame.tiles.get(key);if(channel){if(!tile){tile={styleChannels:new Map(),styleCounts:new Map()};frame.tiles.set(key,tile);}tile.styleChannels.set(entry.styleIndex,channel.slice());}else if(tile){tile.styleChannels.delete(entry.styleIndex);tile.styleCounts.delete(entry.styleIndex);if(!tile.styleChannels.size)frame.tiles.delete(key);}});
      restoreMetadata(frame,currentMetadata);rebuildDerived(frame);v4.markFrameIncomplete(frame,direction==='undo'?'undo-restore-failed':'redo-restore-failed');throw error;
    }
  }  function restoreEntry(entry,direction){
    var frame=entry.frame,state=entry.state,target=direction==='undo'?entry.beforeTiles:entry.afterTiles,metadata=direction==='undo'?entry.beforeMetadata:entry.afterMetadata,aux=direction==='undo'?entry.beforeAux:entry.afterAux;
    if(!v4.isFrame(frame)||!metadata)throw new Error('Smart Raster v4 history target is unavailable');
    if(entry.patchMode==='style-channel')return restoreStyleChannelEntry(entry,direction,metadata);
    var currentTiles=new Map(),currentMetadata=snapshotMetadata(frame),currentAux=new Map();
    entry.keys.forEach(function(key){currentTiles.set(key,cloneTile(frame.tiles.get(key)));currentAux.set(key,{order:cloneOrder(state.tileOrder.get(key)),comparable:state.comparableTiles.has(key)?state.comparableTiles.get(key).slice():null});});
    try{
      if(root.__smartRasterV4ForceHistoryFailure)throw new Error('Forced Smart Raster v4 history failure');
      target.forEach(function(tile,key){if(tile)frame.tiles.set(key,cloneTile(tile));else frame.tiles.delete(key);});
      restoreMetadata(frame,metadata);entry.keys.forEach(function(key){restoreAux(state,key,aux.get(key));});
      rebuildDerived(frame);invalidateTiles(frame,entry.keys,true);v4.validateFrame(frame);
    }catch(error){
      currentTiles.forEach(function(tile,key){if(tile)frame.tiles.set(key,cloneTile(tile));else frame.tiles.delete(key);});
      restoreMetadata(frame,currentMetadata);entry.keys.forEach(function(key){restoreAux(state,key,currentAux.get(key));});rebuildDerived(frame);
      v4.markFrameIncomplete(frame,direction==='undo'?'undo-restore-failed':'redo-restore-failed');throw error;
    }
  }
  function restoreCommand(command,direction){
    var restored=[];
    try{command.entries.forEach(function(entry){restoreEntry(entry,direction);restored.push(entry);});command.status=direction==='undo'?'undone':'redone';command.failure=null;return true;}
    catch(error){
      var rollback=direction==='undo'?'redo':'undo';
      for(var i=restored.length-1;i>=0;i--)try{restoreEntry(restored[i],rollback);}catch(ignored){v4.markFrameIncomplete(restored[i].frame,'history-rollback-failed');}
      command.status='failed';command.failure={direction:direction,message:error.message||String(error)};root.__smartRasterV4LastHistoryError=command.failure;return false;
    }
  }
  function cleanupTrackedLayers(){var live=new Set(currentLayers()||[]);Array.from(trackedLayers).forEach(function(layer){if(!live.has(layer)){trackedLayers.delete(layer);framesByLayer.delete(layer);}});}
  function cleanupHistory(){
    cleanupTrackedLayers();var live=new Set(currentLayers()||[]);
    function clean(command){
      command.entries=command.entries.filter(function(entry){
        if(!live.has(entry.layer)||!stateByFrame.has(entry.frame))return false;
        var frames=framesByLayer.get(entry.layer);if(!frames||frames.get(entry.frameIndex)!==entry.frame)return false;
        if(!entry.layer.frames||entry.frameIndex<0||entry.frameIndex>=entry.layer.frames.length){frames.delete(entry.frameIndex);return false;}
        return true;
      });
      return command.entries.length>0;
    }
    historyUndo=historyUndo.filter(clean);historyRedo=historyRedo.filter(clean);
  }  function snapshotBytes(snapshot){if(snapshot instanceof Uint16Array)return snapshot.byteLength;var bytes=0;if(snapshot)snapshot.styleChannels.forEach(function(channel){bytes+=channel.byteLength;});return bytes;}
  function historyDiagnostics(){
    cleanupHistory();var commands=historyUndo.concat(historyRedo),snapshots=new Set(),bytes=0,largest=null;
    function commandSummary(command){
      var commandBytes=0,beforeCount=0,afterCount=0,tiles=new Set(),frames=[];
      command.entries.forEach(function(entry){
        entry.keys.forEach(function(key){tiles.add(key);});
        entry.beforeTiles.forEach(function(snapshot){if(snapshot)beforeCount++;if(snapshot&&!snapshots.has(snapshot)){snapshots.add(snapshot);var size=snapshotBytes(snapshot);bytes+=size;commandBytes+=size;}});
        entry.afterTiles.forEach(function(snapshot){if(snapshot)afterCount++;if(snapshot&&!snapshots.has(snapshot)){snapshots.add(snapshot);var size=snapshotBytes(snapshot);bytes+=size;commandBytes+=size;}});
        entry.beforeChannels.forEach(function(snapshot){if(snapshot)beforeCount++;if(snapshot&&!snapshots.has(snapshot)){snapshots.add(snapshot);var size=snapshotBytes(snapshot);bytes+=size;commandBytes+=size;}});
        entry.afterChannels.forEach(function(snapshot){if(snapshot)afterCount++;if(snapshot&&!snapshots.has(snapshot)){snapshots.add(snapshot);var size=snapshotBytes(snapshot);bytes+=size;commandBytes+=size;}});
        frames.push({layerIndex:entry.layerIndex,frameIndex:entry.frameIndex,affectedTiles:Array.from(entry.keys),beforeTileCount:beforeCount,afterTileCount:afterCount,lifecycleBefore:entry.beforeMetadata&&entry.beforeMetadata.lifecycle.state,lifecycleAfter:entry.afterMetadata&&entry.afterMetadata.lifecycle.state});
      });
      var result={id:command.id,operation:command.operation,status:command.status,failure:command.failure,affectedTileCount:tiles.size,retainedBytes:commandBytes,frames:frames};
      if(!largest||commandBytes>largest.retainedBytes)largest=result;return result;
    }
    var summaries=commands.map(commandSummary),recent=historyUndo.length?historyUndo[historyUndo.length-1]:(historyRedo.length?historyRedo[historyRedo.length-1]:null);
    return {undoCount:historyUndo.length,redoCount:historyRedo.length,commandCount:commands.length,historyLimit:HISTORY_LIMIT,uniqueTileSnapshots:snapshots.size,estimatedCoverageBufferBytes:bytes,largestCommand:largest,mostRecentCommand:recent?summaries[commands.indexOf(recent)]:null,commands:summaries,integration:'diagnostic-mirrored-history',lastFailure:root.__smartRasterV4LastHistoryError||null};
  }  function undoDebug(){cleanupHistory();var command=historyUndo.pop();if(!command)return {success:false,reason:'empty-history'};var success=restoreCommand(command,'undo');if(success)historyRedo.push(command);else historyUndo.push(command);return {success:success,commandId:command.id,operation:command.operation,failure:command.failure};}
  function redoDebug(){cleanupHistory();var command=historyRedo.pop();if(!command)return {success:false,reason:'empty-redo'};var success=restoreCommand(command,'redo');if(success)historyUndo.push(command);else historyRedo.push(command);return {success:success,commandId:command.id,operation:command.operation,failure:command.failure};}  function existingShadowFrame(layer,frameIndex){
    var frames=framesByLayer.get(layer);return frames?frames.get(frameIndex)||null:null;
  }
  function invalidateTiles(frame,keys,invalidateOwner){
    var state=stateByFrame.get(frame),invalidated=0;
    keys.forEach(function(key){
      frame.dirtyTiles.add(key);
      if(state){
        if(state.compositeTiles.delete(key))invalidated++;
        if(invalidateOwner!==false)state.ownerTiles.delete(key);
        state.comparisons.delete(key);state.errors.delete(key);
      }
    });
    return invalidated;
  }
  function recordEditDiagnostic(type,details){
    root.__smartRasterV4LastEdit=Object.assign({type:type},details||{});
    return root.__smartRasterV4LastEdit;
  }
  function applyColorErase(edit){
    var allLayers=currentLayers(),layer=allLayers&&allLayers[edit.layerIndex],frame=layer&&existingShadowFrame(layer,edit.frameIndex);
    if(!frame)return recordEditDiagnostic('color-erase',{skipped:true,reason:'no-shadow-frame'});
    v4.noteEdit(frame,'color-erase');
    var styleIndex=v4.getStyleIndex(frame,edit.styleId);
    if(!styleIndex)return recordEditDiagnostic('color-erase',{skipped:true,reason:'style-not-recorded',styleId:edit.styleId});
    var command=createHistoryCommand('color-erase'),entry=createHistoryEntry(frame,stateByFrame.get(frame),layer,edit.layerIndex,edit.frameIndex);command.entries.push(entry);v4.noteEdit(frame,'color-erase');
    var beforeTiles=frame.tiles.size,beforeChannels=(frame.styleTiles.get(styleIndex)||new Set()).size,changedTiles=new Set(),changedPixels=0;
    edit.touched.forEach(function(offset){
      var erase=edit.coverage[offset];if(!(erase>0))return;
      var x=offset%edit.width,y=Math.floor(offset/edit.width);captureBefore(entry,v4.pixelLocation(frame,x,y).key);
      var result=v4.reduceStyleCoverage(frame,styleIndex,x,y,erase);if(result.changed){changedPixels++;changedTiles.add(result.tileKey);}
    });
    try{captureAfter(entry);if(changedPixels)pushHistory(command);}catch(error){failHistoryCapture(command,error);}
    var invalidated=invalidateTiles(frame,changedTiles),rendered=composeDirtyTiles(frame,stateByFrame.get(frame)),afterChannels=(frame.styleTiles.get(styleIndex)||new Set()).size;
    var liveComparison=null;
    if(liveEraserSession&&liveEraserSession.frame===frame&&liveEraserSession.styleId===edit.styleId&&liveEraserSession.coverage===edit.coverage){
      var comparedTiles=0,mismatchedPixels=0,firstMismatch=null,state=stateByFrame.get(frame);
      liveEraserSession.tiles.forEach(function(live,key){
        var committed=state.compositeTiles.get(key),length=live.length;comparedTiles++;
        for(var i=0;i<length;i+=4){
          var mismatch=live[i]!==((committed&&committed[i])||0)||live[i+1]!==((committed&&committed[i+1])||0)||live[i+2]!==((committed&&committed[i+2])||0)||live[i+3]!==((committed&&committed[i+3])||0);
          if(mismatch){mismatchedPixels++;if(!firstMismatch)firstMismatch={tileKey:key,pixelOffset:i/4,live:Array.from(live.slice(i,i+4)),committed:committed?Array.from(committed.slice(i,i+4)):[0,0,0,0]};}
        }
      });
      liveComparison={comparedTiles:comparedTiles,mismatchedPixels:mismatchedPixels,pixelIdentical:mismatchedPixels===0,firstMismatch:firstMismatch,changedCoverageIndexes:liveEraserSession.changedIndexes.size};
      if(root.smartRasterV4DebugAssertions===true&&mismatchedPixels)throw new Error('Smart Raster v4 live Color Eraser preview differs from its committed result');
    }
    liveEraserSession=null;
    if(changedPixels)refreshVisibleLayer(layer);
    return recordEditDiagnostic('color-erase',{layerIndex:edit.layerIndex,frameIndex:edit.frameIndex,styleId:edit.styleId,changedPixels:changedPixels,changedTiles:Array.from(changedTiles),deletedChannels:beforeChannels-afterChannels,deletedTiles:beforeTiles-frame.tiles.size,ownershipInvalidations:changedTiles.size,compositeInvalidations:invalidated,liveCommitComparison:liveComparison,lifecycle:v4.lifecycleSummary(frame)});
  }  function recolorStyle(styleId,options){resolvedStyleCache.delete(styleId);compositionVersion++;options=options||{};
    var command=options.interactive?null:createHistoryCommand('rgb-recolor'),framesChanged=[],totalTiles=0,totalInvalidations=0;
    trackedLayers.forEach(function(layer){var frames=framesByLayer.get(layer);if(!frames)return;frames.forEach(function(frame,frameIndex){
      var styleIndex=v4.getStyleIndex(frame,styleId);if(!styleIndex)return;var keys=v4.dirtyStyle(frame,styleIndex);if(!keys.length)return;
      var entry=command?createHistoryEntry(frame,stateByFrame.get(frame),layer,(currentLayers()||[]).indexOf(layer),frameIndex):null;if(entry){keys.forEach(function(key){entry.keys.add(key);entry.beforeAux.set(key,{order:cloneOrder(entry.state.tileOrder.get(key)),comparable:entry.state.comparableTiles.has(key)?entry.state.comparableTiles.get(key).slice():null});entry.afterAux.set(key,{order:cloneOrder(entry.state.tileOrder.get(key)),comparable:entry.state.comparableTiles.has(key)?entry.state.comparableTiles.get(key).slice():null});});command.entries.push(entry);}
      v4.noteEdit(frame,'rgb-recolor');var invalidated=invalidateTiles(frame,new Set(keys),false);totalTiles+=keys.length;totalInvalidations+=invalidated;
      var rendered=composeDirtyTiles(frame,stateByFrame.get(frame),true);framesChanged.push({frameIndex:frameIndex,dirtyTiles:keys.slice(),recomposedTiles:rendered.completed,lifecycle:v4.lifecycleSummary(frame)});if(entry)entry.afterMetadata=snapshotMetadata(frame);
    });});
    if(command&&command.entries.length)pushHistory(command);
    var activeList=currentLayers(),activeLayer=activeList&&typeof curLayer!=='undefined'?activeList[curLayer]:null;if(activeLayer)refreshVisibleLayer(activeLayer,{skipTimeline:!!options.interactive});
    return recordEditDiagnostic('rgb-recolor',{styleId:styleId,interactive:!!options.interactive,frames:framesChanged,recolorDirtiedTiles:totalTiles,ownershipInvalidations:0,compositeInvalidations:totalInvalidations});
  }  function deleteStyle(styleId){resolvedStyleCache.delete(styleId);compositionVersion++;
    var command=createHistoryCommand('style-delete'),framesChanged=[],deletedChannels=0,deletedTiles=0,invalidations=0;
    trackedLayers.forEach(function(layer){var frames=framesByLayer.get(layer);if(!frames)return;frames.forEach(function(frame,frameIndex){
      var styleIndex=v4.getStyleIndex(frame,styleId);if(!styleIndex)return;var usage=v4.styleUsage(frame,styleIndex),keys=new Set(usage.tileKeys),beforeTiles=frame.tiles.size;
      var entry=createHistoryEntry(frame,stateByFrame.get(frame),layer,(currentLayers()||[]).indexOf(layer),frameIndex);entry.patchMode='style-channel';entry.styleIndex=styleIndex;keys.forEach(function(key){entry.keys.add(key);var tile=frame.tiles.get(key),channel=tile&&tile.styleChannels.get(styleIndex);entry.beforeChannels.set(key,channel?channel.slice():null);entry.afterChannels.set(key,null);});command.entries.push(entry);
      v4.noteEdit(frame,'style-delete');var removed=v4.removeStyleContributions(frame,styleIndex);entry.afterMetadata=snapshotMetadata(frame);
      invalidations+=invalidateTiles(frame,keys);var rendered=composeDirtyTiles(frame,stateByFrame.get(frame));deletedChannels+=removed;deletedTiles+=beforeTiles-frame.tiles.size;
      framesChanged.push({frameIndex:frameIndex,changedTiles:Array.from(keys),recomposedTiles:rendered.completed,deletedChannels:removed,deletedTiles:beforeTiles-frame.tiles.size,lifecycle:v4.lifecycleSummary(frame)});
    });});
    if(command.entries.length)pushHistory(command);
    var activeList=currentLayers(),activeLayer=activeList&&typeof curLayer!=='undefined'?activeList[curLayer]:null;if(activeLayer&&activeLayer.renderMode==='style-layering')refreshVisibleLayer(activeLayer);
    return recordEditDiagnostic('style-delete',{styleId:styleId,frames:framesChanged,deletedChannels:deletedChannels,deletedTiles:deletedTiles,ownershipInvalidations:Array.from(framesChanged).reduce(function(sum,item){return sum+item.changedTiles.length;},0),compositeInvalidations:invalidations});
  }  function styleUsageDebug(styleId,frame){
    if(v4.isFrame(frame))return v4.styleUsage(frame,styleId);
    var active=activeShadowFrame();
    if(active){var usage=v4.styleUsage(active,styleId);usage.lifecycle=v4.lifecycleSummary(active);return usage;}
    var frames=[];
    trackedLayers.forEach(function(layer){var map=framesByLayer.get(layer);if(map)map.forEach(function(item,frameIndex){var usage=v4.styleUsage(item,styleId);if(usage.registered)frames.push({frameIndex:frameIndex,usage:usage,lifecycle:v4.lifecycleSummary(item)});});});
    return {styleId:styleId,frames:frames,used:frames.some(function(item){return item.usage.used;})};
  }
  function isStyleUsed(styleId){
    var used=false;trackedLayers.forEach(function(layer){var map=framesByLayer.get(layer);if(map)map.forEach(function(frame){if(v4.styleUsage(frame,styleId).used)used=true;});});return used;
  }
  function recordShadow(commit){
    var allLayers=currentLayers(),layer=allLayers&&allLayers[commit.layerIndex];if(!layer||layer.type!=='smart-raster')return null;
    var ensured=ensureShadowFrame(layer,commit.layerIndex,commit.frameIndex,commit.frameWidth,commit.frameHeight),frame=ensured.frame,state=ensured.state,mode=String(commit.blendMode||'normal');v4.noteBlendMode(frame,mode);
    if(mode!=='normal'){root.__smartRasterV4LastShadowRecord={layerIndex:commit.layerIndex,frameIndex:commit.frameIndex,styleId:commit.styleId,blendMode:mode,skipped:true,reason:'unsupported-blend-mode'};return null;}
    var command=createHistoryCommand('normal-paint'),entry=createHistoryEntry(frame,state,layer,commit.layerIndex,commit.frameIndex);command.entries.push(entry);v4.noteEdit(frame,'normal-paint');
    var styleIndex=v4.ensureStyleIndex(frame,commit.styleId);
    var result=v4.recordNormalMask(frame,styleIndex,commit.maskData,commit.rect,commit.strokeOpacity,function(pixel){captureBefore(entry,pixel.tileKey);updateComparablePixel(state,commit,pixel);});
    updateTileOrder(state,styleIndex,result.touchedTiles);try{captureAfter(entry);if(result.touchedPixels)pushHistory(command);}catch(error){failHistoryCapture(command,error);}
    if(root.smartRasterV4DebugAssertions===true)v4.validateFrame(frame);var composition=composeDirtyTiles(frame,state);
    root.__smartRasterV4LastShadowRecord={layerIndex:commit.layerIndex,frameIndex:commit.frameIndex,styleIndex:styleIndex,styleId:commit.styleId,touchedPixels:result.touchedPixels,touchedTiles:Array.from(result.touchedTiles),composedTiles:composition.completed,failedTiles:composition.failed};return result;
  }  function activeShadowFrame(){
    var allLayers=currentLayers(),layerIndex=typeof curLayer!=='undefined'?curLayer:-1,frameIndex=typeof curFrame!=='undefined'?curFrame:-1;
    var layer=allLayers&&allLayers[layerIndex],frames=layer&&framesByLayer.get(layer);
    return frames?frames.get(frameIndex)||null:null;
  }
  function resolveFrame(frame){return v4.isFrame(frame)?frame:activeShadowFrame();}
  function aggregateComparisons(state){
    var result={supportedTiles:0,unsupportedTiles:0,comparedPixels:0,mismatchedPixels:0,matchedPixels:0,maxChannelDelta:0,totalAbsoluteDelta:0};
    state.comparisons.forEach(function(item){
      if(item.supported)result.supportedTiles++;else result.unsupportedTiles++;
      if(!item.supported)return;
      result.comparedPixels+=item.comparedPixels;result.mismatchedPixels+=item.mismatchedPixels;result.matchedPixels+=item.matchedPixels;
      result.maxChannelDelta=Math.max(result.maxChannelDelta,item.maxChannelDelta);result.totalAbsoluteDelta+=item.totalAbsoluteDelta;
    });
    result.meanAbsoluteDelta=result.comparedPixels?result.totalAbsoluteDelta/(result.comparedPixels*4):0;
    return result;
  }
  function clippedRect(frame,rect){
    var x=Math.max(0,Math.floor(Number(rect&&rect.x)||0)),y=Math.max(0,Math.floor(Number(rect&&rect.y)||0));
    var right=Math.min(frame.width,Math.ceil(x+Math.max(0,Number(rect&&(rect.width==null?rect.w:rect.width))||0))),bottom=Math.min(frame.height,Math.ceil(y+Math.max(0,Number(rect&&(rect.height==null?rect.h:rect.height))||0)));
    return right>x&&bottom>y?{x:x,y:y,width:right-x,height:bottom-y}:null;
  }
  function tileKeysForRect(frame,rect){
    var keys=[];if(!rect)return keys;var minX=Math.floor(rect.x/TILE_SIZE),maxX=Math.floor((rect.x+rect.width-1)/TILE_SIZE),minY=Math.floor(rect.y/TILE_SIZE),maxY=Math.floor((rect.y+rect.height-1)/TILE_SIZE);
    for(var ty=minY;ty<=maxY;ty++)for(var tx=minX;tx<=maxX;tx++)keys.push(v4.tileKey(tx,ty));return keys;
  }
  function cloneTransientTile(source){
    var tile={styleChannels:new Map(),styleCounts:new Map()};if(source){source.styleChannels.forEach(function(channel,index){tile.styleChannels.set(index,channel);});source.styleCounts.forEach(function(count,index){tile.styleCounts.set(index,count);});}return tile;
  }
  function uploadPreviewTile(target,rendered,reusableImage){
    if(!target||typeof target.getContext!=='function')return null;var d=rendered.dimensions,ctx=target.getContext('2d'),image=reusableImage;
    if(!image||image.width!==d.width||image.height!==d.height)image=ctx.createImageData(d.width,d.height);
    for(var y=0;y<d.height;y++)for(var x=0;x<d.width;x++){var source=(y*TILE_SIZE+x)*4,dest=(y*d.width+x)*4;image.data[dest]=rendered.rgba[source];image.data[dest+1]=rendered.rgba[source+1];image.data[dest+2]=rendered.rgba[source+2];image.data[dest+3]=rendered.rgba[source+3];}
    ctx.putImageData(image,d.x,d.y);return image;
  }  function livePaintPreview(options){
    var prof=root.BrushLatencyProfiler&&root.BrushLatencyProfiler.enabled?root.BrushLatencyProfiler:null,totalStart=prof?performance.now():0,started=prof?performance.now():0;
    options=options||{};var frame=activeShadowFrame(),state=frame&&stateByFrame.get(frame),layer=state&&state.layer;
    if(prof)prof.measure('smart-raster-preview-state-resolution',started,{frame:!!frame,state:!!state,layer:!!layer});
    if(!frame||!state||!layer||layer.renderMode!=='style-layering'||!options.maskCanvas||!options.targetCanvas||!options.styleId)return {success:false,reason:'style-layering-preview-unavailable'};
    started=prof?performance.now():0;var rect=clippedRect(frame,options.rect);if(prof)prof.measure('smart-raster-preview-rect-clipping',started,{rect:rect});if(!rect)return {success:true,tiles:[]};
    started=prof?performance.now():0;var styleIndex=options.nonDestructive?v4.getStyleIndex(frame,options.styleId):v4.ensureStyleIndex(frame,options.styleId);if(prof)prof.measure('smart-raster-style-bundle-synchronization',started,{styleId:options.styleId,styleIndex:styleIndex,nonDestructive:!!options.nonDestructive});if(!styleIndex)return {success:false,reason:'style-not-registered-for-nondestructive-preview'};
    started=prof?performance.now():0;var mask=options.maskCanvas.getContext('2d',{willReadFrequently:true}).getImageData(rect.x,rect.y,rect.width,rect.height).data;if(prof)prof.measure('smart-raster-preview-mask-readback',started,{rect:rect,pixels:rect.width*rect.height});
    var opacity=Math.max(0,Math.min(1,Number(options.opacity))),renderedKeys=[],keys=tileKeysForRect(frame,rect),indexUpdateMs=0,ownershipMs=0,uploadMs=0;
    keys.forEach(function(key){var dimensions=tileDimensions(frame,key),tile=cloneTransientTile(frame.tiles.get(key)),base=tile.styleChannels.get(styleIndex),channel=base?base.slice():new Uint16Array(TILE_SIZE*TILE_SIZE),changed=false,part=performance.now();
      var ix0=Math.max(rect.x,dimensions.x),iy0=Math.max(rect.y,dimensions.y),ix1=Math.min(rect.x+rect.width,dimensions.x+dimensions.width),iy1=Math.min(rect.y+rect.height,dimensions.y+dimensions.height);
      for(var y=iy0;y<iy1;y++)for(var x=ix0;x<ix1;x++){var maskOffset=((y-rect.y)*rect.width+x-rect.x)*4+3,source=v4.coverageFromUnit((mask[maskOffset]/255)*opacity);if(!source)continue;var local=(y-dimensions.y)*TILE_SIZE+x-dimensions.x,previous=channel[local],next=previous+Math.round((v4.MAX_COVERAGE-previous)*source/v4.MAX_COVERAGE);if(next!==previous){channel[local]=next;changed=true;}}
      indexUpdateMs+=performance.now()-part;if(!changed)return;tile.styleChannels.set(styleIndex,channel);part=performance.now();var result=compositeTile(frame,state,key,tile);ownershipMs+=performance.now()-part;part=performance.now();uploadPreviewTile(options.targetCanvas,result);uploadMs+=performance.now()-part;renderedKeys.push(key);
    });
    if(prof){prof.recordDuration('smart-raster-style-index-canvas-update',indexUpdateMs,{tiles:keys.length});prof.recordDuration('smart-raster-preview-ownership-resolution',ownershipMs,{tiles:renderedKeys.length});prof.recordDuration('smart-raster-preview-canvas-upload',uploadMs,{tiles:renderedKeys.length});prof.measure('smart-raster-preview-generation-total',totalStart,{rect:rect,tiles:renderedKeys.length});}
    root.__smartRasterV4LastLivePreview={type:'paint',rect:rect,tileKeys:renderedKeys.slice(),styleId:options.styleId};return {success:true,tiles:renderedKeys,rect:rect};
  }  function liveColorErasePreview(options){
    var started=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
    options=options||{};var frame=activeShadowFrame(),state=frame&&stateByFrame.get(frame),layer=state&&state.layer;
    if(!frame||!state||!layer||layer.renderMode!=='style-layering'||!options.coverage||!options.styleId)return {success:false,reason:'style-layering-eraser-preview-unavailable'};
    var rect=clippedRect(frame,options.rect),styleIndex=v4.getStyleIndex(frame,options.styleId);if(!rect||!styleIndex)return {success:true,tiles:[]};
    if(!liveEraserSession||liveEraserSession.frame!==frame||liveEraserSession.styleId!==options.styleId||liveEraserSession.coverage!==options.coverage)liveEraserSession={frame:frame,styleId:options.styleId,coverage:options.coverage,tiles:new Map(),changedIndexes:new Set(),workTiles:new Map(),indexGroups:new Map(),calls:0,totalMs:0,worstMs:0,totalTiles:0,bufferAllocations:0};
    var session=liveEraserSession,dabIndexes=options.dabIndexes&&typeof options.dabIndexes.forEach==='function'?options.dabIndexes:[],rectRight=rect.x+rect.width,rectBottom=rect.y+rect.height,debug=root.smartRasterV4DebugAssertions===true;
    session.indexGroups.forEach(function(group){group.length=0;});
    dabIndexes.forEach(function(index){
      var x=index%frame.width,y=Math.floor(index/frame.width);if(debug&&(x<rect.x||x>=rectRight||y<rect.y||y>=rectBottom))throw new Error('Smart Raster v4 eraser changed coverage outside the current dab rectangle');
      session.changedIndexes.add(index);var key=v4.pixelLocation(frame,x,y).key,group=session.indexGroups.get(key);if(!group){group=[];session.indexGroups.set(key,group);}group.push(index);
    });
    var workTilesBefore=session.workTiles.size,renderedKeys=[],diagnostic=debug?[]:null;
    session.indexGroups.forEach(function(indexes,key){
      if(!indexes.length)return;var original=frame.tiles.get(key),base=original&&original.styleChannels.get(styleIndex);if(!base)return;
      var work=session.workTiles.get(key);
      if(!work){
        var tile=cloneTransientTile(original),channel=base.slice();tile.styleChannels.set(styleIndex,channel);
        work={tile:tile,base:base,channel:channel,scratch:{},ordered:null,orderVersion:-1,imageData:null};session.workTiles.set(key,work);session.bufferAllocations+=5;
      }
      if(work.orderVersion!==compositionVersion){work.ordered=orderedContributors(frame,state,key,work.tile);work.orderVersion=compositionVersion;}
      var dimensions=tileDimensions(frame,key),changed=debug?[]:null,changedCount=0;
      for(var n=0;n<indexes.length;n++){
        var global=indexes[n],x=global%frame.width,y=Math.floor(global/frame.width),local=(y-dimensions.y)*TILE_SIZE+x-dimensions.x,erase=Math.max(0,Math.min(1,Number(options.coverage[global])||0)),next=Math.round(work.base[local]*(1-erase));
        if(next!==work.channel[local]){work.channel[local]=next;changedCount++;if(debug)changed.push(global);}
      }
      if(!changedCount)return;
      if(debug){original.styleChannels.forEach(function(originalChannel,index){if(index!==styleIndex&&work.tile.styleChannels.get(index)!==originalChannel)throw new Error('Smart Raster v4 eraser modified a non-target style channel');});}
      var result=compositeTile(frame,state,key,work.tile,work.scratch,work.ordered);work.imageData=uploadPreviewTile(typeof activeC!=='undefined'?activeC:null,result,work.imageData);session.tiles.set(key,result.rgba);renderedKeys.push(key);if(debug)diagnostic.push({tileKey:key,changedCoverageIndexes:changed});
    });
    var elapsed=(typeof performance!=='undefined'&&performance.now?performance.now():Date.now())-started;session.calls++;session.totalMs+=elapsed;session.worstMs=Math.max(session.worstMs,elapsed);session.totalTiles+=renderedKeys.length;
    root.__smartRasterV4ColorEraserPerformance={calls:session.calls,averagePointerFrameMs:session.totalMs/session.calls,worstPointerFrameMs:session.worstMs,averageTilesPerFrame:session.totalTiles/session.calls,lastTiles:renderedKeys.length,reusedTileBuffers:session.workTiles.size,typedBufferAllocationsThisFrame:(session.workTiles.size-workTilesBefore)*5,typedBufferAllocationsThisStroke:session.bufferAllocations,estimatedRetainedScratchBytes:session.workTiles.size*114688};
    root.__smartRasterV4LastLivePreview={type:'color-erase',rect:rect,tileKeys:renderedKeys.slice(),styleId:options.styleId,dabChangedCoverageCount:options.dabIndexes&&options.dabIndexes.size!=null?options.dabIndexes.size:options.dabIndexes&&options.dabIndexes.length||0,tiles:diagnostic};return {success:true,tiles:renderedKeys,rect:rect,renderTimeMs:elapsed};
  }  function ensureCanvasForState(state){
    var layer=state.layer;if(!layer)return null;if(!layer.frames)layer.frames={};var canvas=layer.frames[state.frameIndex];
    if(!canvas&&typeof document!=='undefined'){canvas=document.createElement('canvas');canvas.width=state.frame.width;canvas.height=state.frame.height;layer.frames[state.frameIndex]=canvas;}
    return canvas||null;
  }
  function bakedPixelStack(frame,state,key,tileOffset,styleMap){
    var tile=frame.tiles.get(key);if(!tile)return {owner:0,stack:[]};var ordered=orderedContributors(frame,state,key,tile).contributors,pr=0,pg=0,pb=0,pa=0,owner=0,stack=[];
    ordered.forEach(function(item){var coverage=item.coverage[tileOffset]/v4.MAX_COVERAGE,rgba=item.style.rgba,sa=coverage*(rgba[3]/255);if(sa<=0)return;if(pa>0){var priorId=v4.getStyleId(frame,owner),priorIndex=styleMap.get(priorId)||0;stack.push({index:priorIndex,rgba:[Math.round(pr/pa*255),Math.round(pg/pa*255),Math.round(pb/pa*255),Math.round(pa*255)]});}var remain=1-sa;pr=(rgba[0]/255)*sa+pr*remain;pg=(rgba[1]/255)*sa+pg*remain;pb=(rgba[2]/255)*sa+pb*remain;pa=sa+pa*remain;owner=item.styleIndex;});
    return {owner:owner,stack:stack};
  }  function writeVisibleTile(frame,state,key,rendered){
    var canvas=ensureCanvasForState(state);if(!canvas||typeof canvas.getContext!=='function')return false;var d=rendered.dimensions,ctx=canvas.getContext('2d'),image=ctx.createImageData?ctx.createImageData(d.width,d.height):{data:new Uint8ClampedArray(d.width*d.height*4)};
    for(var y=0;y<d.height;y++)for(var x=0;x<d.width;x++){var source=(y*TILE_SIZE+x)*4,target=(y*d.width+x)*4;image.data[target]=rendered.rgba[source];image.data[target+1]=rendered.rgba[source+1];image.data[target+2]=rendered.rgba[source+2];image.data[target+3]=rendered.rgba[source+3];}
    if(ctx.putImageData)ctx.putImageData(image,d.x,d.y);
    var li=(currentLayers()||[]).indexOf(state.layer),owned=root.SmartRasterLayer&&typeof root.SmartRasterLayer.ensureFrame==='function'?root.SmartRasterLayer.ensureFrame(li,state.frameIndex):null;
    if(owned){
      var styleMap=new Map();frame.styleIdToIndex.forEach(function(v4Index,styleId){styleMap.set(styleId,root.SmartRasterLayer.ensureStyleIndex(li,state.frameIndex,styleId));});for(var py=0;py<d.height;py++)for(var px=0;px<d.width;px++){var tileOffset=py*TILE_SIZE+px,offset=(d.y+py)*owned.width+d.x+px,baked=bakedPixelStack(frame,state,key,tileOffset,styleMap),styleId=baked.owner?v4.getStyleId(frame,baked.owner):null;owned.styleIds[offset]=styleId?(styleMap.get(styleId)||0):0;if(owned.underlays){if(baked.stack.length)owned.underlays[offset]=baked.stack;else delete owned.underlays[offset];}}
    }
    var activeUsesCanvas=typeof curLayer!=='undefined'&&typeof curFrame!=='undefined'&&li===curLayer&&(state.frameIndex===curFrame||(typeof getHeldKey==='function'&&getHeldKey(li,curFrame)===canvas));
    if(activeUsesCanvas&&typeof activeC!=='undefined'&&activeC&&activeC!==canvas){var active=activeC.getContext('2d');if(active&&active.putImageData)active.putImageData(image,d.x,d.y);}
    return true;
  }
  function layerFrameKeys(layer){var keys=new Set();Object.keys(layer.frames||{}).forEach(function(key){keys.add(Number(key));});Object.keys(layer.smartStyleFrames||{}).forEach(function(key){keys.add(Number(key));});return Array.from(keys).filter(Number.isInteger);}
  function styleLayeringEligibility(layer){
    if(!layer||layer.type!=='smart-raster')return {eligible:false,reason:'active-layer-is-not-smart-raster'};var map=framesByLayer.get(layer),keys=layerFrameKeys(layer);
    if(!keys.length){if(!layer.smartRasterV4Native)return {eligible:false,reason:'legacy-layer-has-no-native-contributions'};return {eligible:true,reason:null};}
    for(var i=0;i<keys.length;i++){var frame=map&&map.get(keys[i]);if(!frame)return {eligible:false,reason:'missing-v4-frame:'+keys[i]};if(!v4.isAuthorityEligible(frame))return {eligible:false,reason:'incomplete-v4-frame:'+keys[i],lifecycle:v4.lifecycleSummary(frame)};var missing=null;frame.indexToStyleId.forEach(function(styleId){if(missing)return;try{resolveStyle(styleId);}catch(error){missing=styleId;}});if(missing)return {eligible:false,reason:'missing-palette-style:'+missing};}
    return {eligible:true,reason:null};
  }
function refreshVisibleLayer(layer,options){
    var li=(currentLayers()||[]).indexOf(layer);
    if(li<0||typeof curLayer==='undefined'||li!==curLayer)return;
    if(typeof recomposite==='function')recomposite(curLayer,typeof curFrame!=='undefined'?curFrame:0);
    if(!(options&&options.skipTimeline)&&typeof renderTimeline==='function')renderTimeline();
  }
  function setStyleLayering(layer,enabled){
    enabled=!!enabled;
    if(!layer||layer.type!=="smart-raster")return {success:false,reason:"active-layer-is-not-smart-raster"};
    if(enabled){
      var eligibility=styleLayeringEligibility(layer);
      if(!eligibility.eligible)return Object.assign({success:false},eligibility);
      var keys=layerFrameKeys(layer),li=(currentLayers()||[]).indexOf(layer);
      if(!keys.length){var fi=typeof curFrame!=="undefined"?curFrame:0;ensureShadowFrame(layer,li,fi,typeof CW!=="undefined"?CW:1,typeof CH!=="undefined"?CH:1);}
      layer.renderMode="style-layering";
      var map=framesByLayer.get(layer),failed=[];
      if(map)map.forEach(function(frame){frame.tiles.forEach(function(tile,key){frame.dirtyTiles.add(key);});var result=renderFrame(frame);failed=failed.concat(result.failed);});
      if(failed.length){layer.renderMode="legacy";return {success:false,reason:"v4-visible-render-failed",failedTiles:failed};}
    }else{
      if(layer.renderMode!=="style-layering"){layer.renderMode="legacy";return {success:true,changed:false};}
      var map=framesByLayer.get(layer),failed=[];
      if(map)map.forEach(function(frame){frame.tiles.forEach(function(tile,key){frame.dirtyTiles.add(key);});var result=renderFrame(frame);failed=failed.concat(result.failed);});
      if(failed.length)return {success:false,reason:"v4-bake-failed",failedTiles:failed};
      layer.renderMode="legacy";
    }
    refreshVisibleLayer(layer);
    root.dispatchEvent(new CustomEvent("smart-raster-style-layering-changed",{detail:{layer:layer,enabled:enabled}}));
    return {success:true,changed:true,renderMode:layer.renderMode};
  }
  function activeStyleLayeringState(){var list=currentLayers(),layer=list&&typeof curLayer!=='undefined'?list[curLayer]:null,eligibility=styleLayeringEligibility(layer);return {enabled:!!(layer&&layer.renderMode==='style-layering'),available:!!eligibility.eligible,reason:eligibility.reason,layer:layer||null};}  function renderFrame(frame){frame=resolveFrame(frame);if(!frame)return {completed:[],failed:[],skipped:[],renderTimeMs:0,cacheRebuilds:0};return composeDirtyTiles(frame,stateByFrame.get(frame));}
  function renderAllFrames(){var summary={renderedFrames:0,renderedTiles:0,failedTiles:0,skippedTiles:0,renderTimeMs:0};trackedLayers.forEach(function(layer){var map=framesByLayer.get(layer);if(!map)return;map.forEach(function(frame){if(!frame.dirtyTiles.size)return;var result=renderFrame(frame);summary.renderedFrames++;summary.renderedTiles+=result.completed.length;summary.failedTiles+=result.failed.length;summary.skippedTiles+=result.skipped.length;summary.renderTimeMs+=result.renderTimeMs;});});return summary;}
  function renderDiagnostics(frame){frame=resolveFrame(frame);if(!frame)return null;var before=frame.dirtyTiles.size,result=renderFrame(frame),state=stateByFrame.get(frame);return {renderedTileCount:result.completed.length,dirtyTileCount:frame.dirtyTiles.size,dirtyTileCountBefore:before,renderTimeMs:result.renderTimeMs,recomposedTiles:result.completed.slice(),skippedTiles:result.skipped.slice(),failedTiles:result.failed.slice(),cacheRebuilds:result.cacheRebuilds,lifecycle:v4.lifecycleSummary(frame),comparison:aggregateComparisons(state),cache:{compositeTiles:state.compositeTiles.size,ownerTiles:state.ownerTiles.size}};}
  function differenceHeatmap(frame){frame=resolveFrame(frame);if(!frame)return null;renderFrame(frame);var state=stateByFrame.get(frame),tiles=[];state.comparisons.forEach(function(comparison,key){if(!comparison.firstMismatch)return;var rgba=new Uint8ClampedArray(TILE_SIZE*TILE_SIZE*4),rendered=state.compositeTiles.get(key),dimensions=tileDimensions(frame,key),canvas=authoritativeCanvas(state);if(!canvas||!rendered)return;var actual=canvas.getContext('2d',{willReadFrequently:true}).getImageData(dimensions.x,dimensions.y,dimensions.width,dimensions.height).data;for(var y=0;y<dimensions.height;y++)for(var x=0;x<dimensions.width;x++){var local=(y*dimensions.width+x)*4,tileOffset=(y*TILE_SIZE+x)*4,delta=0;for(var c=0;c<4;c++)delta=Math.max(delta,Math.abs(actual[local+c]-rendered[tileOffset+c]));if(delta){rgba[tileOffset]=255;rgba[tileOffset+1]=Math.max(0,255-delta*4);rgba[tileOffset+3]=Math.min(255,delta*4);}}tiles.push({tileKey:key,rgba:rgba});});return {width:frame.width,height:frame.height,tileSize:TILE_SIZE,tiles:tiles};}  function debugFrame(frame){
    frame=resolveFrame(frame);if(!frame)return null;
    var state=stateByFrame.get(frame),channels=0,coveragePixels=0,styles=[];
    frame.tiles.forEach(function(tile){tile.styleChannels.forEach(function(channel){channels++;for(var i=0;i<channel.length;i++)if(channel[i]!==0)coveragePixels++;});});
    frame.styleTiles.forEach(function(keys,index){styles.push({styleIndex:index,styleId:v4.getStyleId(frame,index),tileCount:keys.size,bounds:frame.styleBounds.get(index)||null});});
    styles.sort(function(a,b){return a.styleIndex-b.styleIndex;});
    return {
      version:frame.version,width:frame.width,height:frame.height,tileSize:frame.tileSize,coverageSemantics:frame.coverageSemantics,lifecycle:v4.lifecycleSummary(frame),tileCount:frame.tiles.size,
      occupiedStyles:styles,occupiedStyleCount:styles.length,dirtyTileCount:frame.dirtyTiles.size,
      allocatedChannels:channels,totalCoveragePixels:coveragePixels,compositeTileCount:state?state.compositeTiles.size:0,
      ownerTileCount:state?state.ownerTiles.size:0,colorEncoding:'straight-rgba8 palette input; premultiplied float compositing',
      comparison:state?aggregateComparisons(state):null,comparisonTiles:state?Array.from(state.comparisons.values()):[],
      errors:state?Array.from(state.errors.values()):[],render:state?Object.assign({},state.renderStats):null,lastEdit:root.__smartRasterV4LastEdit||null,valid:v4.validateFrame(frame)
    };
  }
  function v3Pixel(state,x,y){
    var canvas=authoritativeCanvas(state);
    if(!canvas)return null;
    return Array.from(canvas.getContext('2d',{willReadFrequently:true}).getImageData(x,y,1,1).data);
  }
  function styleStackAt(x,y,layer,frameIndex){
    var allLayers=currentLayers();layer=layer||(allLayers&&typeof curLayer!=='undefined'?allLayers[curLayer]:null);
    if(!layer||layer.type!=='smart-raster')return[];frameIndex=frameIndex==null?(typeof curFrame!=='undefined'?curFrame:0):Number(frameIndex);
    var frame=existingShadowFrame(layer,frameIndex);if(!frame)return[];x=Math.floor(Number(x));y=Math.floor(Number(y));if(x<0||y<0||x>=frame.width||y>=frame.height)return[];
    var state=stateByFrame.get(frame),location=v4.pixelLocation(frame,x,y),tile=frame.tiles.get(location.key);if(!tile)return[];
    var ordered=orderedContributors(frame,state,location.key,tile).contributors,stack=[];
    for(var i=ordered.length-1;i>=0;i--){var contributor=ordered[i],coverage=contributor.coverage[location.offset],styleAlpha=contributor.style.rgba[3]/255;
      if(!coverage||styleAlpha<=0)continue;stack.push({styleId:contributor.style.id,styleIndex:contributor.styleIndex,coverage:coverage,coverageUnit:coverage/v4.MAX_COVERAGE,effectiveAlpha:(coverage/v4.MAX_COVERAGE)*styleAlpha});
    }
    return stack;
  }
  function styleCoverageMask(styleId,layer,frameIndex){
    var allLayers=currentLayers();layer=layer||(allLayers&&typeof curLayer!=='undefined'?allLayers[curLayer]:null);
    if(!layer||layer.type!=='smart-raster')return null;frameIndex=frameIndex==null?(typeof curFrame!=='undefined'?curFrame:0):Number(frameIndex);
    var frame=existingShadowFrame(layer,frameIndex);if(!frame)return null;var styleIndex=v4.getStyleIndex(frame,styleId);if(!styleIndex)return{mask:new Uint8ClampedArray(frame.width*frame.height),width:frame.width,height:frame.height,styleIndex:0,matchedPixelCount:0};
    var mask=new Uint8ClampedArray(frame.width*frame.height),matched=0;
    frame.tiles.forEach(function(tile,key){var channel=tile.styleChannels.get(styleIndex);if(!channel)return;var dimensions=tileDimensions(frame,key);
      for(var y=0;y<dimensions.height;y++)for(var x=0;x<dimensions.width;x++){var tileOffset=y*TILE_SIZE+x;if(!channel[tileOffset])continue;mask[(dimensions.y+y)*frame.width+dimensions.x+x]=255;matched++;}
    });
    return{mask:mask,width:frame.width,height:frame.height,styleIndex:styleIndex,matchedPixelCount:matched};
  }
  function captureStyleTransform(styleId,layer,frameIndex){
    var frame=existingShadowFrame(layer,Number(frameIndex));if(!frame)return null;var state=stateByFrame.get(frame),styleIndex=v4.getStyleIndex(frame,styleId);if(!state||!styleIndex)return null;
    var coverage=new Uint16Array(frame.width*frame.height),source=new Uint8ClampedArray(frame.width*frame.height*4),background=new Uint8ClampedArray(frame.width*frame.height*4),above=new Uint8ClampedArray(frame.width*frame.height*4),style=resolveStyle(styleId),orderBefore=new Set(),orderAfter=new Set();
    if(layer.renderMode==='style-layering'){
      var selectedPriority=palettePriority().priority.get(styleId);frame.indexToStyleId.forEach(function(otherId,index){if(index===styleIndex)return;var otherPriority=palettePriority().priority.get(otherId);if(otherPriority>selectedPriority)orderBefore.add(index);else orderAfter.add(index);});
    }else frame.tiles.forEach(function(tile,key){
      if(!tile.styleChannels.has(styleIndex))return;var ordered=orderedContributors(frame,state,key,tile),split=ordered.contributors.findIndex(function(item){return item.styleIndex===styleIndex;});if(split<0)return;
      ordered.contributors.slice(0,split).forEach(function(item){orderBefore.add(item.styleIndex);});ordered.contributors.slice(split+1).forEach(function(item){orderAfter.add(item.styleIndex);});
    });
    frame.tiles.forEach(function(tile,key){var dimensions=tileDimensions(frame,key),channel=tile.styleChannels.get(styleIndex),ordered=orderedContributors(frame,state,key,tile),before=[],after=[];ordered.contributors.forEach(function(item){if(item.styleIndex===styleIndex)return;if(orderAfter.has(item.styleIndex))after.push(item);else before.push(item);});
      var rendered=compositeTile(frame,state,key,tile,{}, {contributors:before,supported:ordered.supported,reasons:ordered.reasons}),renderedAbove=compositeTile(frame,state,key,tile,{}, {contributors:after,supported:ordered.supported,reasons:ordered.reasons});
      for(var y=0;y<dimensions.height;y++)for(var x=0;x<dimensions.width;x++){var tileOffset=y*TILE_SIZE+x,pixel=(dimensions.y+y)*frame.width+dimensions.x+x,rgbaOffset=pixel*4,tileRgba=tileOffset*4,value=channel?channel[tileOffset]:0;coverage[pixel]=value;
        if(value){source[rgbaOffset]=style.rgba[0];source[rgbaOffset+1]=style.rgba[1];source[rgbaOffset+2]=style.rgba[2];source[rgbaOffset+3]=Math.round((value/v4.MAX_COVERAGE)*style.rgba[3]);}
        background[rgbaOffset]=rendered.rgba[tileRgba];background[rgbaOffset+1]=rendered.rgba[tileRgba+1];background[rgbaOffset+2]=rendered.rgba[tileRgba+2];background[rgbaOffset+3]=rendered.rgba[tileRgba+3];
        above[rgbaOffset]=renderedAbove.rgba[tileRgba];above[rgbaOffset+1]=renderedAbove.rgba[tileRgba+1];above[rgbaOffset+2]=renderedAbove.rgba[tileRgba+2];above[rgbaOffset+3]=renderedAbove.rgba[tileRgba+3];
      }
    });return{styleId:styleId,styleIndex:styleIndex,width:frame.width,height:frame.height,coverage:coverage,sourceRgba:source,backgroundRgba:background,aboveRgba:above,renderMode:layer.renderMode==='style-layering'?'style-layering':'legacy',orderBefore:Array.from(orderBefore),orderAfter:Array.from(orderAfter)};
  }
  function syncTransformedTileOrder(frame,state,key,styleIndex,payload){
    var tile=frame.tiles.get(key),order=state.tileOrder.get(key),runs=order?order.runs.filter(function(index,pos,list){return index!==styleIndex&&list.indexOf(index)===pos&&tile&&tile.styleChannels.has(index);}):[];
    if(tile&&tile.styleChannels.has(styleIndex)){var before=new Set(payload.orderBefore||[]),after=new Set(payload.orderAfter||[]),lower=0,upper=runs.length;runs.forEach(function(index,pos){if(before.has(index))lower=Math.max(lower,pos+1);if(after.has(index))upper=Math.min(upper,pos);});runs.splice(Math.min(Math.max(lower,0),upper),0,styleIndex);}
    if(runs.length)state.tileOrder.set(key,{runs:runs,seen:new Set(runs),unsupported:order?order.unsupported:false,reasons:order?order.reasons.slice():[]});else state.tileOrder.delete(key);
  }
  function replaceStyleTransform(payload,layer,frameIndex,coverage){
    if(!payload||!layer||!(coverage instanceof Uint16Array))return false;var frame=existingShadowFrame(layer,Number(frameIndex)),state=frame&&stateByFrame.get(frame);if(!frame||!state||coverage.length!==frame.width*frame.height)return false;
    var styleIndex=v4.getStyleIndex(frame,payload.styleId);if(!styleIndex)return false;var affected=new Set(frame.styleTiles.get(styleIndex)||[]);v4.removeStyleContributions(frame,styleIndex);
    for(var y=0;y<frame.height;y++)for(var x=0;x<frame.width;x++){var value=coverage[y*frame.width+x];if(value)v4.setCoverage(frame,styleIndex,x,y,value);}
    rebuildDerived(frame);var movedKeys=frame.styleTiles.get(styleIndex);if(movedKeys)movedKeys.forEach(function(key){affected.add(key);});
    affected.forEach(function(key){syncTransformedTileOrder(frame,state,key,styleIndex,payload);});
    affected.forEach(function(key){frame.dirtyTiles.add(key);});invalidateTiles(frame,affected,true);
    var rendered=composeDirtyTiles(frame,state,true);
    root.__smartRasterV4LastStyleTransform={styleId:payload.styleId,frameIndex:Number(frameIndex),renderMode:payload.renderMode,invalidatedTiles:Array.from(affected),recomposedTiles:rendered.completed.slice(),failedTiles:rendered.failed.slice(),bounds:frame.styleBounds.get(styleIndex)||null};
    return true;
  }
  function deleteStyleContributionsFromFrame(styleIds,layer,frameIndex){
    if(!Array.isArray(styleIds)||!styleIds.length||!layer)return false;
    frameIndex=Number(frameIndex);var frame=existingShadowFrame(layer,frameIndex),state=frame&&stateByFrame.get(frame);
    if(!frame||!state||!v4.isAuthorityEligible(frame))return false;
    var indices=[],affected=new Set();
    styleIds.forEach(function(styleId){var index=v4.getStyleIndex(frame,styleId);if(!index||indices.indexOf(index)>=0)return;indices.push(index);var keys=frame.styleTiles.get(index);if(keys)keys.forEach(function(key){affected.add(key);});});
    if(!indices.length)return false;
    indices.forEach(function(index){v4.noteEdit(frame,'style-delete');v4.removeStyleContributions(frame,index);});
    affected.forEach(function(key){indices.forEach(function(index){syncTransformedTileOrder(frame,state,key,index,{});});frame.dirtyTiles.add(key);});
    invalidateTiles(frame,affected,true);var rendered=composeDirtyTiles(frame,state,true);refreshVisibleLayer(layer);
    root.__smartRasterV4LastSelectionDelete={styleIds:styleIds.slice(),frameIndex:frameIndex,changedTiles:Array.from(affected),recomposedTiles:rendered.completed.slice(),failedTiles:rendered.failed.slice()};
    return rendered.failed.length===0;
  }  function styleIsAuthoritative(layer,frameIndex,styleId){var frame=existingShadowFrame(layer,Number(frameIndex));if(!frame||!v4.isAuthorityEligible(frame))return false;return !!v4.getStyleIndex(frame,styleId);}
  function debugPixel(x,y,frame){
    frame=resolveFrame(frame);if(!frame)return null;
    x=Math.floor(Number(x));y=Math.floor(Number(y));
    var state=stateByFrame.get(frame),location=v4.pixelLocation(frame,x,y),tile=frame.tiles.get(location.key),styles=[];
    if(tile)tile.styleChannels.forEach(function(channel,index){
      var coverage=channel[location.offset];
      if(coverage!==0)styles.push({styleIndex:index,styleId:v4.getStyleId(frame,index),coverage:coverage,coverageUnit:coverage/v4.MAX_COVERAGE});
    });
    styles.sort(function(a,b){return a.styleIndex-b.styleIndex;});
    var composite=state&&state.compositeTiles.get(location.key),owner=state&&state.ownerTiles.get(location.key),rgbaOffset=location.offset*4;
    var v4Rgba=composite?Array.from(composite.slice(rgbaOffset,rgbaOffset+4)):null;
    var v3Rgba=state?v3Pixel(state,x,y):null;
    return {
      x:x,y:y,tileKey:location.key,tileOffset:location.offset,styles:styles,
      comparable:!!(state&&state.comparableTiles.get(location.key)&&state.comparableTiles.get(location.key)[location.offset]),
      v4Rgba:v4Rgba,v3Rgba:v3Rgba,matches:!!v4Rgba&&!!v3Rgba&&v4Rgba.every(function(value,index){return value===v3Rgba[index];}),
      topOwnerIndex:owner?owner[location.offset]:0,topOwnerStyleId:owner&&owner[location.offset]?v4.getStyleId(frame,owner[location.offset]):null,
      tileComparison:state&&state.comparisons.get(location.key)||null,tileError:state&&state.errors.get(location.key)||null
    };
  }

  function utf8Bytes(value){
    if(typeof TextEncoder!=='undefined')return new TextEncoder().encode(value).byteLength;
    return unescape(encodeURIComponent(value)).length;
  }
  function serializeTileOrder(state){var result=[];if(!state)return result;state.tileOrder.forEach(function(order,key){result.push({key:key,runs:order.runs.slice(),unsupported:!!order.unsupported,reasons:order.reasons.slice()});});return result;}
  function restoreTileOrder(state,saved,frame){
    state.tileOrder.clear();if(!Array.isArray(saved))return;
    saved.forEach(function(item){
      if(!item||typeof item.key!=='string'||!frame.tiles.has(item.key)||!Array.isArray(item.runs))return;
      var runs=item.runs.map(Number).filter(function(index,pos,list){return Number.isInteger(index)&&index>0&&frame.indexToStyleId.has(index)&&list.indexOf(index)===pos;});
      if(runs.length)state.tileOrder.set(item.key,{runs:runs,seen:new Set(runs),unsupported:!!item.unsupported,reasons:Array.isArray(item.reasons)?item.reasons.map(String):[]});
    });
  }
  function serializeV4Layer(layer){
    var map=framesByLayer.get(layer);if(!map||!map.size)return null;
    var frames=[];map.forEach(function(frame,frameIndex){if(!v4.isFrame(frame))return;frames.push({frameIndex:Number(frameIndex),frame:v4.serializeFrame(frame),tileOrder:serializeTileOrder(stateByFrame.get(frame))});});frames.sort(function(a,b){return a.frameIndex-b.frameIndex;});
    var payload={version:v4.SERIALIZATION_VERSION,formatRevision:v4.FORMAT_REVISION,tileSize:TILE_SIZE,frames:frames};
    serializationReport.serializedFrameCount=frames.length;serializationReport.serializedBytes=utf8Bytes(JSON.stringify(payload));serializationReport.lifecycleStates={};frames.forEach(function(item){var state=item.frame.lifecycle.state;serializationReport.lifecycleStates[state]=(serializationReport.lifecycleStates[state]||0)+1;});return payload;
  }
  function legacyV4Layer(layer){
    framesByLayer.delete(layer);trackedLayers.delete(layer);legacyStateByLayer.set(layer,{state:'legacy-v3-only',authorityEligible:false,incompleteReasons:['no-v4-contributions']});serializationReport.legacyLayers++;serializationReport.validationWarnings.push('v3-only Smart Raster layer loaded without v4 contribution data');return {loaded:0,rejected:0,legacy:true};
  }
  function deserializeV4Layer(layer,payload){
    if(!payload)return legacyV4Layer(layer);
    var rejected=[],loaded=0,rebuilt=0;
    if(!payload||payload.version!==v4.SERIALIZATION_VERSION||payload.formatRevision!==v4.FORMAT_REVISION||payload.tileSize!==TILE_SIZE||!Array.isArray(payload.frames)){
      serializationReport.rejectedFrames.push({frameIndex:null,reason:'unsupported-or-malformed-v4-layer-payload'});framesByLayer.delete(layer);trackedLayers.delete(layer);legacyStateByLayer.set(layer,{state:'legacy-v3-only',authorityEligible:false,incompleteReasons:['rejected-v4-payload']});return {loaded:0,rejected:1,legacy:true};
    }
    var map=new Map(),seen=new Set();legacyStateByLayer.delete(layer);
    payload.frames.forEach(function(item){
      var frameIndex=Number(item&&item.frameIndex);
      try{
        if(!Number.isInteger(frameIndex)||frameIndex<0||seen.has(frameIndex))throw new Error('Smart Raster v4 frame identity is invalid or duplicated');seen.add(frameIndex);
        var frame=v4.deserializeFrame(item.frame),v3=layer.smartStyleFrames&&layer.smartStyleFrames[frameIndex],artwork=layer.frames&&layer.frames[frameIndex];
        var width=v3&&v3.width||artwork&&artwork.width,height=v3&&v3.height||artwork&&artwork.height;if(width&&height&&(frame.width!==width||frame.height!==height))throw new Error('Smart Raster v4 frame dimensions do not match v3');
        map.set(frameIndex,frame);var state=createState(frame,layer,(currentLayers()||[]).indexOf(layer),frameIndex);restoreTileOrder(state,item.tileOrder,frame);loaded++;rebuilt+=frame.styleTiles.size;
      }catch(error){rejected.push({frameIndex:Number.isInteger(frameIndex)?frameIndex:null,reason:error&&error.message?error.message:String(error)});}
    });
    if(map.size){framesByLayer.set(layer,map);trackedLayers.add(layer);}else{framesByLayer.delete(layer);trackedLayers.delete(layer);}
    serializationReport.loadedFrameCount=loaded;serializationReport.rebuiltIndexes=rebuilt;serializationReport.rejectedFrames=serializationReport.rejectedFrames.concat(rejected);serializationReport.lifecycleStates={};map.forEach(function(frame){var state=frame.lifecycle.state;serializationReport.lifecycleStates[state]=(serializationReport.lifecycleStates[state]||0)+1;});
    return {loaded:loaded,rejected:rejected.length,errors:rejected,legacy:loaded===0};
  }
  function serializationDiagnostics(){
    cleanupTrackedLayers();var frames=0,tiles=0,styles=0,lifecycle={},liveLegacy=0;(currentLayers()||[]).forEach(function(layer){if(legacyStateByLayer.has(layer))liveLegacy++;});trackedLayers.forEach(function(layer){var map=framesByLayer.get(layer);if(!map)return;map.forEach(function(frame){frames++;tiles+=frame.tiles.size;styles+=frame.styleTiles.size;var state=frame.lifecycle.state;lifecycle[state]=(lifecycle[state]||0)+1;});});
    return Object.assign({},serializationReport,{liveFrameCount:frames,liveLegacyLayerCount:liveLegacy,tileCount:tiles,styleCount:styles,lifecycleStates:lifecycle,rejectedFrames:serializationReport.rejectedFrames.slice(),validationWarnings:serializationReport.validationWarnings.slice()});
  }  function cloneSerialized(value){return value==null?null:JSON.parse(JSON.stringify(value));}
  function captureFrameSnapshot(layer,frameIndex){var frame=existingShadowFrame(layer,Number(frameIndex));return frame?cloneSerialized({frame:v4.serializeFrame(frame),tileOrder:serializeTileOrder(stateByFrame.get(frame))}):null;}
  function restoreFrameSnapshot(layer,frameIndex,snapshot){
    frameIndex=Number(frameIndex);var map=shadowFrames(layer);
    if(!snapshot){map.delete(frameIndex);documentReport.lastOperation={type:'delete-frame',frameIndex:frameIndex};return null;}
    try{var saved=cloneSerialized(snapshot),frame=v4.deserializeFrame(saved.frame||saved);map.set(frameIndex,frame);var state=createState(frame,layer,(currentLayers()||[]).indexOf(layer),frameIndex);restoreTileOrder(state,saved.tileOrder,frame);documentReport.lastOperation={type:'restore-frame',frameIndex:frameIndex,tileCount:frame.tiles.size};return frame;}
    catch(error){documentReport.validationErrors.push({operation:'restore-frame',frameIndex:frameIndex,reason:error.message||String(error)});throw error;}
  }
  function deleteV4Frame(layer,frameIndex){var map=framesByLayer.get(layer),removed=!!(map&&map.delete(Number(frameIndex)));documentReport.lastOperation={type:'delete-frame',frameIndex:Number(frameIndex),removed:removed};return removed;}
  function remapLayerFrames(layer,mapper,type){
    var map=framesByLayer.get(layer);if(!map||!map.size)return 0;var next=new Map(),moved=0;
    map.forEach(function(frame,index){var target=mapper(Number(index));if(target===null||target===undefined||target<0)return;if(next.has(target))throw new Error('Smart Raster v4 document operation produced duplicate frame identities');next.set(target,frame);var state=stateByFrame.get(frame);if(state)state.frameIndex=target;historyUndo.concat(historyRedo).forEach(function(command){command.entries.forEach(function(entry){if(entry.layer===layer&&entry.frame===frame)entry.frameIndex=target;});});if(target!==index)moved++;});
    framesByLayer.set(layer,next);documentReport.lastOperation={type:type||'remap-frames',movedFrames:moved};documentReport.operations.push(documentReport.lastOperation);return moved;
  }
  function shiftLayerFrames(layer,delta,start){delta=Number(delta);start=start==null?0:Number(start);if(!Number.isInteger(delta)||!Number.isInteger(start))throw new TypeError('Smart Raster v4 frame shift is invalid');return remapLayerFrames(layer,function(index){return index>=start?index+delta:index;},'shift-frames');}
  function moveLayerFrame(layer,source,target){source=Number(source);target=Number(target);if(!Number.isInteger(source)||!Number.isInteger(target)||source<0||target<0)throw new TypeError('Smart Raster v4 frame move is invalid');var snapshot=captureFrameSnapshot(layer,source);deleteV4Frame(layer,source);return restoreFrameSnapshot(layer,target,snapshot);}
  function captureLayerSnapshot(layer){var payload=serializeV4Layer(layer);if(!payload&&layer&&layer.__smartRasterV4Snapshot)payload=layer.__smartRasterV4Snapshot;return cloneSerialized(payload);}
  function storeLayerSnapshot(layer,payload){try{Object.defineProperty(layer,'__smartRasterV4Snapshot',{value:cloneSerialized(payload),writable:true,configurable:true,enumerable:false});}catch(error){layer.__smartRasterV4Snapshot=cloneSerialized(payload);}return layer;}
  function restoreLayerSnapshot(layer,payload){payload=payload||layer&&layer.__smartRasterV4Snapshot;if(!payload)return legacyV4Layer(layer);var result=deserializeV4Layer(layer,cloneSerialized(payload));storeLayerSnapshot(layer,payload);documentReport.lastOperation={type:'restore-layer',loadedFrames:result.loaded,rejectedFrames:result.rejected};return result;}
  function cloneLayerSnapshot(source,target){var payload=captureLayerSnapshot(source);storeLayerSnapshot(target,payload);return payload;}
  function resizeV4Frames(width,height,offsetX,offsetY){var changed=0;(currentLayers()||[]).forEach(function(layer){var map=framesByLayer.get(layer);if(!map)return;map.forEach(function(frame,index){var resized=v4.resizeFrame(frame,width,height,offsetX,offsetY);map.set(index,resized);createState(resized,layer,(currentLayers()||[]).indexOf(layer),index);changed++;});});documentReport.lastOperation={type:'resize-canvas',width:width,height:height,frames:changed};documentReport.operations.push(documentReport.lastOperation);return changed;}
  function documentDiagnostics(){return {lastOperation:documentReport.lastOperation,operationCount:documentReport.operations.length,validationErrors:documentReport.validationErrors.slice()};}  root.SmartRasterStyleLayering={setEnabled:setStyleLayering,getActiveState:activeStyleLayeringState,getEligibility:styleLayeringEligibility};
  root.SmartRasterV4Document={captureFrame:captureFrameSnapshot,restoreFrame:restoreFrameSnapshot,deleteFrame:deleteV4Frame,shiftFrames:shiftLayerFrames,moveFrame:moveLayerFrame,captureLayer:captureLayerSnapshot,storeLayerSnapshot:storeLayerSnapshot,restoreLayer:restoreLayerSnapshot,cloneLayer:cloneLayerSnapshot,resizeAllFrames:resizeV4Frames};
  root.SmartRasterV4Serialization={serializeLayer:serializeV4Layer,deserializeLayer:deserializeV4Layer,markLegacyLayer:legacyV4Layer};
  root.SmartRasterV4DebugDigest=function(){var frame=activeShadowFrame();if(!frame)return null;var value=JSON.stringify(v4.serializeFrame(frame)),hash=2166136261;for(var i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}return{hash:(hash>>>0).toString(16),length:value.length,tileCount:frame.tiles.size};};
  root.SmartRasterV4LivePaintPreview=livePaintPreview;
  root.SmartRasterV4LiveColorErasePreview=liveColorErasePreview;
  root.SmartRasterV4ShadowRecorder=recordShadow;
  root.SmartRasterV4ShadowColorErase=applyColorErase;
  root.SmartRasterV4ShadowRecolorStyle=recolorStyle;
  root.SmartRasterV4ShadowDeleteStyle=deleteStyle;
  root.SmartRasterV4ShadowIsStyleUsed=isStyleUsed;
  root.SmartRasterV4StyleStackAt=styleStackAt;
  root.SmartRasterV4StyleCoverageMask=styleCoverageMask;
  root.SmartRasterV4CaptureStyleTransform=captureStyleTransform;
  root.SmartRasterV4ReplaceStyleTransform=replaceStyleTransform;
  root.SmartRasterV4DeleteStyleContributionsFromFrame=deleteStyleContributionsFromFrame;
  root.SmartRasterV4StyleIsAuthoritative=styleIsAuthoritative;
  if(typeof root.smartRasterV4DebugAssertions!=='boolean')root.smartRasterV4DebugAssertions=false;
  root.debugSmartRasterV4=debugFrame;
  root.debugSmartRasterV4Pixel=debugPixel;
  root.debugSmartRasterV4Render=renderDiagnostics;
  root.debugSmartRasterV4Difference=differenceHeatmap;
  root.debugSmartRasterV4Style=styleUsageDebug;
  root.debugSmartRasterV4History=historyDiagnostics;
  root.debugSmartRasterV4Serialization=serializationDiagnostics;
  root.debugSmartRasterV4DocumentOperations=documentDiagnostics;
  root.undoSmartRasterV4Debug=undoDebug;
  root.redoSmartRasterV4Debug=redoDebug;
  root.addEventListener('advanced-palette-style-color-changed',function(event){var detail=event&&event.detail||{},styleId=detail.styleId;if(styleId)recolorStyle(styleId,{interactive:detail.interactive===true});});
  root.addEventListener('advanced-palette-order-changed',function(){palettePriorityCache=null;compositionVersion++;trackedLayers.forEach(function(layer){var map=framesByLayer.get(layer);if(map)map.forEach(function(frame){frame.tiles.forEach(function(tile,key){frame.dirtyTiles.add(key);});});});renderAllFrames();var list=currentLayers(),active=list&&typeof curLayer!=='undefined'?list[curLayer]:null;if(active&&active.renderMode==='style-layering')refreshVisibleLayer(active);});
  root.addEventListener('active-artwork-changed',function(){liveEraserSession=null;renderFrame(activeShadowFrame());});
})(typeof window!=='undefined'?window:globalThis);
