import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRestoreController } from '../assets/js/core/restore-controller.js';
import { emptyLearning } from '../assets/js/core/learning-schema.js';
const now = 1791172800000;
const timeZone = 'Asia/Taipei';
const data = () => ({ stats: { schemaVersion: 1, byScope: {} }, progress: { schemaVersion: 1, items: {} },
  learning: emptyLearning({now,timeZone}), prefs: {theme:'light'} });
const bytes = () => JSON.stringify({format:'lang-learn.backup',version:2,exportedAt:now,...data()});
function fixture() {
  const calls = [];
  let meta = {revision:1,dataEpoch:'fixture-epoch'};
  let seq=0;
  const repository = { ready: async()=>({...meta}), restoreLearning: async(command)=> {
    calls.push(command); meta={revision:meta.revision+1,dataEpoch:'restored-epoch'};
    return {...meta};
  }};
  const controller=createRestoreController({repository,now:()=>now,timeZone:()=>timeZone,
    nextOperationId:()=>`restore-${++seq}`,savePreferences:async(prefs)=>{calls.push({prefs});return true;}});
  return {controller,repository,calls,change:()=>{meta.revision++;}};
}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}

test('F06/O17 檔案、代碼、Google 共用固定預覽，確認前不寫入',async()=>{
  for(const source of ['file','code','google']){
    const {controller,calls}=fixture();
    let reads=0;
    const preview=await controller.preview(async()=>{reads++;return bytes();},{source});
    assert.equal(preview.canRestoreLearning,true);
    assert.equal(preview.source,source);
    assert.equal(calls.length,0);
    assert.equal('data' in preview,false,'不把可修改payload交給UI');
    const result=await controller.confirm();
    assert.equal(reads,1,'確認不重新讀檔或下載');
    assert.equal(result.learningSaved,true);
    assert.equal(result.preferencesSaved,true);
    assert.equal(calls.length,2);
    assert.equal(calls[0].expectedRevision,1);
    assert.equal(calls[0].epoch,'fixture-epoch');
    assert.equal(controller.current(),null);
  }
});

test('F06/G06 晚到的舊讀取不可蓋掉新預覽，取消也使回應失效',async()=>{
  const {controller}=fixture(); const old=deferred();
  const first=controller.preview(()=>old.promise,{source:'google'});
  const second=await controller.preview(async()=>bytes(),{source:'file'});
  old.resolve(bytes());
  await assert.rejects(first,{code:'STALE_PREVIEW'});
  assert.equal(controller.current().previewId,second.previewId);
  const slow=deferred(); const pending=controller.preview(()=>slow.promise,{source:'google'});
  controller.cancel(); slow.resolve(bytes());
  await assert.rejects(pending,{code:'STALE_PREVIEW'});
  assert.equal(controller.current(),null);
});

test('F06/O18 預覽後另一頁更新，不可在確認時偷換新 revision',async()=>{
  const {controller,calls,change}=fixture();
  await controller.preview(async()=>bytes(),{source:'code'}); change();
  await assert.rejects(controller.confirm(),{code:'STALE_PREVIEW'});
  assert.equal(calls.length,0);
});

test('F06/O17 同時確認只送一次，交易失敗保留相同 operationId 可重試',async()=>{
  const {controller,repository}=fixture(); const gate=deferred(); let calls=0;const ids=[];
  repository.restoreLearning=async(command)=>{calls++;ids.push(command.operationId);await gate.promise;throw Object.assign(new Error('fixture'),{code:'STORAGE_ABORTED'});};
  await controller.preview(async()=>bytes(),{source:'file'});
  const one=controller.confirm(); const two=controller.confirm();
  gate.resolve(); await assert.rejects(one,{code:'STORAGE_ABORTED'}); await assert.rejects(two,{code:'STORAGE_ABORTED'});
  assert.equal(calls,1);
  await assert.rejects(controller.confirm(),{code:'STORAGE_ABORTED'});
  assert.equal(ids[0],ids[1]);
});

test('F06/O17 確認中不允許新預覽讓畫面假裝交易已取消',async()=>{
  const {controller,repository}=fixture(); const gate=deferred();
  repository.restoreLearning=async()=>{await gate.promise;return {revision:2};};
  await controller.preview(async()=>bytes(),{source:'file'});
  const confirming=controller.confirm();
  await assert.rejects(controller.preview(async()=>bytes(),{source:'code'}),{code:'RESTORE_BUSY'});
  assert.throws(()=>controller.cancel(),{code:'RESTORE_BUSY'});
  gate.resolve();await confirming;
});

test('F06/O17 偏好保存失敗不假報完整還原，也不倒退已成功學習資料',async()=>{
  const repository={ready:async()=>({revision:1,dataEpoch:'fixture-epoch'}),restoreLearning:async()=>({revision:2})};
  const controller=createRestoreController({repository,now:()=>now,timeZone:()=>timeZone,nextOperationId:()=> 'restore-1',savePreferences:async()=>false});
  await controller.preview(async()=>bytes()); const result=await controller.confirm();
  assert.equal(result.learningSaved,true);assert.equal(result.preferencesSaved,false);
  assert.match(result.preferenceError,/偏好/);
});

test('F06/O17 純偏好可確認；錯誤內容會清除前一份待匯入資料',async()=>{
  const {controller,calls}=fixture();
  const payload={format:'lang-learn.backup',version:2,prefs:{theme:'dark'}};
  await controller.preview(async()=>JSON.stringify(payload));
  const result=await controller.confirm();assert.equal(result.learningSaved,false);assert.equal(calls.length,1);
  await controller.preview(async()=>bytes());
  await assert.rejects(controller.preview(async()=>'{'),{code:'INVALID_BACKUP'});
  assert.equal(controller.current(),null);
  await assert.rejects(controller.confirm(),{code:'NO_PREVIEW'});
});
