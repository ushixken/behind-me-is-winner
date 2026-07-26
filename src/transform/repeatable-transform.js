'use strict';

// Hidden development controller for TVPaint-style repeatable transform operations.
// It wraps the existing transform engine; no second renderer or public tool is registered.
const FEATURE_REPEATABLE_TRANSFORM=false;
const RepeatableTransformController=(()=>{
  let enabled=FEATURE_REPEATABLE_TRANSFORM,active=false,applying=false,pendingUndoAction=null,lastFocusedField=null;
  const operation={translateX:0,translateY:0,scale:1,rotation:0,pivotX:0,pivotY:0,pivotRotation:0,flipX:false,flipY:false,antiAliasing:'medium',applyTarget:'current'};
  const finite=(value,fallback=0)=>{const parsed=Number.parseFloat(String(value).replace(/[%?]/g,''));return Number.isFinite(parsed)?parsed:fallback;};
  function normalizePatch(patch){
    const next=Object.assign({},patch);
    for(const key of ['translateX','translateY','rotation','pivotX','pivotY','pivotRotation'])if(key in next)next[key]=finite(next[key],operation[key]);
    if('scale'in next){const raw=String(next.scale),number=finite(raw,operation.scale);next.scale=raw.includes('%')||Math.abs(number)>10?number/100:number;if(!(next.scale>0))next.scale=operation.scale;}
    if('antiAliasing'in next&&!['none','weak','medium','strong'].includes(next.antiAliasing))next.antiAliasing=operation.antiAliasing;
    if('applyTarget'in next&&next.applyTarget!=='current')next.applyTarget='current';
    return next;
  }
  function unsupportedReason(){
    if(tfPerspective)return 'Repeatable Transform currently supports Free Transform only.';
    if(tfGroupMode)return 'Repeatable Transform currently supports the active layer or selection only.';
    if(operation.flipX||operation.flipY||operation.pivotRotation)return 'Flip and Pivot Angle are reserved for a later engine-backed implementation.';
    return '';
  }
  function capturePendingUndo(){
    const candidate=undoStack[undoStack.length-1];
    if(candidate&&candidate.layer===curLayer&&candidate.frame===curFrame&&!candidate.type)pendingUndoAction=undoStack.pop();else pendingUndoAction=null;
  }
  function preview(){
    if(!active||!tfActive||tfPerspective||unsupportedReason())return false;
    tfAntialiasing=operation.antiAliasing;tfPivot={x:operation.pivotX,y:operation.pivotY};
    _tfSetStateForPivot({x:operation.pivotX+operation.translateX,y:operation.pivotY+operation.translateY},operation.rotation,operation.scale);
    _tfRedraw(false);return true;
  }
  function start(){
    if(!enabled)return false;
    if(typeof tool!=='undefined'&&tool!=='transform')setTool('transform','Transform');else if(!tfActive)enterTransformTool();
    if(!tfActive||tfPerspective||tfGroupMode){if(typeof showInfo==='function')showInfo(unsupportedReason()||'Nothing to transform.','Repeatable Transform');return false;}
    active=true;Object.assign(operation,{translateX:0,translateY:0,scale:1,rotation:0,pivotX:tfPivot.x,pivotY:tfPivot.y,pivotRotation:0,flipX:false,flipY:false,antiAliasing:tfAntialiasing,applyTarget:'current'});
    capturePendingUndo();preview();_tfRenderOptionsPanel();return true;
  }
  function apply(){
    if(!enabled||!active||applying)return false;const reason=unsupportedReason();if(reason){if(typeof showInfo==='function')showInfo(reason,'Repeatable Transform');return false;}
    applying=true;
    try{
      preview();if(pendingUndoAction){undoStack.push(pendingUndoAction);if(undoStack.length>40)undoStack.shift();redoStack=[];pendingUndoAction=null;}
      commitTransformTool({preserveSessionShell:true});enterTransformTool();if(!tfActive||tfGroupMode)throw new Error('Unable to recapture committed transform source.');
      capturePendingUndo();preview();_tfRenderOptionsPanel();
      if(lastFocusedField){const field=document.querySelector('[data-repeat-field="'+lastFocusedField+'"]');if(field){field.focus();field.select();}}
      return true;
    }catch(error){console.error('[RepeatableTransform]',error);active=false;pendingUndoAction=null;return false;}finally{applying=false;}
  }
  function reset(){if(!active)return false;Object.assign(operation,{translateX:0,translateY:0,scale:1,rotation:0,pivotRotation:0,flipX:false,flipY:false});preview();_tfRenderOptionsPanel();return true;}
  function cancelForToolExit(){if(!active)return false;pendingUndoAction=null;active=false;if(tfActive)cancelTransformTool();_tfRenderOptionsPanel();return true;}
  function cancel(){const changed=cancelForToolExit();if(changed&&typeof tool!=='undefined'&&tool==='transform'&&!tfActive)enterTransformTool();return changed;}
  function setOperation(patch){Object.assign(operation,normalizePatch(patch||{}));if(active)preview();_tfRenderOptionsPanel();return Object.assign({},operation);}
  function fieldRow(label,key,value,suffix){
    const row=document.createElement('label');row.className='tf-repeat-row';const text=document.createElement('span');text.textContent=label;const input=document.createElement('input');input.type='text';input.className='tf-repeat-input';input.dataset.repeatField=key;input.value=String(value)+(suffix||'');
    input.onfocus=()=>{lastFocusedField=key;};input.oninput=()=>{const raw=input.value;if(raw===''||raw==='-'||raw==='.'||raw==='-.')return;const patch={};patch[key]=raw;Object.assign(operation,normalizePatch(patch));preview();};
    input.onkeydown=event=>{if(event.key!=='ArrowUp'&&event.key!=='ArrowDown')return;event.preventDefault();const direction=event.key==='ArrowUp'?1:-1,step=event.shiftKey?10:event.altKey?0.1:1,patch={};patch[key]=key==='scale'?(operation.scale*100+direction*step)+'%':operation[key]+direction*step;Object.assign(operation,normalizePatch(patch));input.value=key==='scale'?String(Math.round(operation.scale*10000)/100)+'%':String(operation[key]);preview();};
    input.onblur=()=>{input.value=key==='scale'?String(Math.round(operation.scale*10000)/100)+'%':String(operation[key]);};row.append(text,input);return row;
  }
  function renderControls(root){
    if(!root)return;root.querySelector('.tf-repeatable-dev')?.remove();if(!enabled)return;
    const panel=document.createElement('section');panel.className='tf-repeatable-dev';const heading=document.createElement('div');heading.className='tf-panel-label';heading.textContent='Repeatable Transform (Development)';panel.appendChild(heading);
    if(!active){const startButton=document.createElement('button');startButton.type='button';startButton.className='tf-repeat-button';startButton.textContent='Start Repeatable Transform';startButton.onclick=start;panel.appendChild(startButton);root.appendChild(panel);return;}
    panel.append(fieldRow('Panning X','translateX',operation.translateX,''),fieldRow('Panning Y','translateY',operation.translateY,''),fieldRow('Scale','scale',Math.round(operation.scale*10000)/100,'%'),fieldRow('Angle','rotation',operation.rotation,'?'),fieldRow('Pivot X','pivotX',operation.pivotX,''),fieldRow('Pivot Y','pivotY',operation.pivotY,''));
    const buttons=document.createElement('div');buttons.className='tf-repeat-actions';[['Apply',apply],['Reset',reset],['Cancel',cancel]].forEach(([label,handler])=>{const button=document.createElement('button');button.type='button';button.className='tf-repeat-button';button.textContent=label;button.onclick=handler;buttons.appendChild(button);});panel.appendChild(buttons);root.appendChild(panel);
  }
  function setEnabled(value){enabled=!!value;if(!enabled&&active)cancelForToolExit();else if(enabled&&typeof tool!=='undefined'&&tool==='transform'&&!active)start();_tfRenderOptionsPanel();return enabled;}
  return {get enabled(){return enabled;},get active(){return active;},get operation(){return Object.assign({},operation);},setEnabled,start,apply,reset,cancel,cancelForToolExit,setOperation,renderControls};
})();
window.RepeatableTransformController=RepeatableTransformController;
const _tfRenderOptionsPanelBase=_tfRenderOptionsPanel;
_tfRenderOptionsPanel=function(){_tfRenderOptionsPanelBase();RepeatableTransformController.renderControls(document.getElementById('tf-options-body'));};
_tfRenderOptionsPanel();
