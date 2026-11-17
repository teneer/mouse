import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OBJECT_CONTROL_LEASE_MS, OBJECT_CONTROL_RENEW_MS, objectControlDocumentId,
  objectControlKey, objectControlLeaseExpired, objectControlOwnerMatches,
  objectControlRequestMatches, timestampMillis
} from '../js/object-control.js';

test('object control IDs are stable and separate page/object pairs',()=>{
  assert.match(objectControlDocumentId('page-a','object-b'),/^obj_[0-9a-f]+$/);
  assert.equal(objectControlKey('page-a','object-b'),'["page-a","object-b"]');
  assert.notEqual(objectControlDocumentId('page-a__object','b'),objectControlDocumentId('page-a','object__b'));
  assert.notEqual(objectControlKey('page-a::object','b'),objectControlKey('page-a','object::b'));
});

test('leases use a long owner window and a shorter renewal interval',()=>{
  assert.equal(OBJECT_CONTROL_LEASE_MS,300000);
  assert.equal(OBJECT_CONTROL_RENEW_MS,60000);
});

test('lease expiry accepts Firestore timestamps, dates and numeric milliseconds',()=>{
  const now=500000;
  assert.equal(timestampMillis({seconds:500,nanoseconds:500000000}),500500);
  assert.equal(objectControlLeaseExpired({ownerDevice:'d',leaseUntil:now+1},now),false);
  assert.equal(objectControlLeaseExpired({ownerDevice:'d',leaseUntil:new Date(now-1)},now),true);
  assert.equal(objectControlLeaseExpired({ownerDevice:null,leaseUntil:now+1000},now),true);
});

test('ownership requires both device and tab identity and the matching token',()=>{
  const lock={ownerDevice:'device-a',ownerTab:'tab-a',token:'token-a'};
  assert.equal(objectControlOwnerMatches(lock,'device-a','tab-a','token-a'),true);
  assert.equal(objectControlOwnerMatches(lock,'device-a','tab-b','token-a'),false);
  assert.equal(objectControlOwnerMatches(lock,'device-b','tab-a','token-a'),false);
  assert.equal(objectControlOwnerMatches(lock,'device-a','tab-a','token-b'),false);
});

test('takeover requests are matched to their requesting tab and request id',()=>{
  const lock={requestDevice:'device-b',requestTab:'tab-b',requestId:'request-1'};
  assert.equal(objectControlRequestMatches(lock,'device-b','tab-b','request-1'),true);
  assert.equal(objectControlRequestMatches(lock,'device-b','tab-a','request-1'),false);
  assert.equal(objectControlRequestMatches(lock,'device-b','tab-b','request-2'),false);
});
