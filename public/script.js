const socket = io();
const $ = id => document.getElementById(id);
let mode = '', role = '', roomId = '', userName = '', className = '';
let localStream = null, screenStream = null, sharing = false, micOn = true, cameraOn = true;
const peers = {}, remoteMeta = {};
const rtc = { iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}] };

function show(el){el.classList.remove('hidden')} function hide(el){el.classList.add('hidden')}
function toast(msg){$('toast').textContent=msg;show($('toast'));setTimeout(()=>hide($('toast')),2500)}
function resetSetup(){hide($('landing'));show($('setup')); hide($('teacherSetup')); hide($('studentSetup')); $('setupError').textContent='';}
$('teacherMode').onclick=()=>{mode='teacher';resetSetup();show($('teacherSetup'));$('teacherName').focus()};
$('studentMode').onclick=()=>{mode='student';resetSetup();show($('studentSetup'));$('studentName').focus()};
$('backBtn').onclick=()=>{hide($('setup'));show($('landing'))};
$('createBtn').onclick=async()=>{const n=$('teacherName').value.trim(), c=$('className').value.trim(); if(!n||!c)return $('setupError').textContent='Enter teacher name and class name.'; role='teacher';userName=n;className=c; socket.emit('create-class',{teacherName:n,className:c});};
$('joinBtn').onclick=async()=>{const n=$('studentName').value.trim(), r=$('joinRoomId').value.trim();if(!n||!r)return $('setupError').textContent='Enter your name and Class ID.';role='student';userName=n;roomId=r;await joinClass()};
socket.on('class-created', async d=>{roomId=d.roomId;className=d.className;hide($('setup'));show($('waiting'));$('createdRoom').textContent=roomId;$('waitingTitle').textContent=`${className} created`;});
$('copyCreatedBtn').onclick=()=>copy(roomId); $('startClassBtn').onclick=()=>joinClass();
async function joinClass(){try{localStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});hide($('landing'));hide($('setup'));hide($('waiting'));show($('classScreen'));$('currentRoom').textContent=roomId;$('classTitle').textContent=className||'Live Class';if(role==='teacher'){show($('endBtn'));}else hide($('endBtn')); addLocalVideo();socket.emit('join-class',{roomId,userName,role});}catch(e){$('setupError').textContent='Camera/Microphone permission આપો અને ફરી પ્રયાસ કરો.';show($('setup'));}}
function addLocalVideo(){const box=document.createElement('div');box.className='video-card local';box.id='localCard';box.innerHTML=`<video id="localVideo" autoplay muted playsinline></video><div class="name-tag">${esc(userName)} <b>YOU</b></div>`;$('videoGrid').appendChild(box);$('localVideo').srcObject=localStream}
function addRemoteVideo(id,name,r='student'){remoteMeta[id]={name,role:r};let card=document.getElementById('v-'+id);if(card)return;card=document.createElement('div');card.className='video-card';card.id='v-'+id;card.innerHTML=`<video id="video-${id}" autoplay playsinline></video><div class="name-tag">${esc(name)} ${r==='teacher'?'<b>TEACHER</b>':''}</div>`;$('videoGrid').appendChild(card)}
function removeVideo(id){document.getElementById('v-'+id)?.remove();delete remoteMeta[id];if(peers[id]){peers[id].close();delete peers[id]}}
function makePeer(id,initiator){const pc=new RTCPeerConnection(rtc);localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));pc.onicecandidate=e=>{if(e.candidate)socket.emit('ice-candidate',{target:id,candidate:e.candidate})};pc.ontrack=e=>{addRemoteVideo(id,remoteMeta[id]?.name||'Participant',remoteMeta[id]?.role);$('video-'+id).srcObject=e.streams[0]};pc.onconnectionstatechange=()=>{if(['failed','closed','disconnected'].includes(pc.connectionState)) removeVideo(id)};peers[id]=pc;if(initiator){pc.createOffer().then(o=>pc.setLocalDescription(o)).then(()=>socket.emit('offer',{target:id,offer:pc.localDescription}))}return pc}
socket.on('class-state',async s=>{className=s.className;$('classTitle').textContent=className;s.existingUsers.forEach(u=>{remoteMeta[u.socketId]={name:u.userName,role:u.role};makePeer(u.socketId,true);addRemoteVideo(u.socketId,u.userName,u.role)});updateParticipants(s.participants)});
socket.on('user-joined',u=>{remoteMeta[u.socketId]={name:u.userName,role:u.role};addRemoteVideo(u.socketId,u.userName,u.role);});
socket.on('offer',async({sender,offer,userName:name,role:r})=>{remoteMeta[sender]={name,role:r};addRemoteVideo(sender,name,r);const pc=peers[sender]||makePeer(sender,false);await pc.setRemoteDescription(offer);const a=await pc.createAnswer();await pc.setLocalDescription(a);socket.emit('answer',{target:sender,answer:pc.localDescription})});
socket.on('answer',async({sender,answer})=>{if(peers[sender])await peers[sender].setRemoteDescription(answer)});
socket.on('ice-candidate',async({sender,candidate})=>{if(peers[sender])try{await peers[sender].addIceCandidate(candidate)}catch(e){}});
socket.on('user-left',id=>removeVideo(id));
socket.on('participants',updateParticipants);
function updateParticipants(list=[]){$('participantsPanel').innerHTML=list.map(p=>`<div class="participant"><span class="avatar">${esc(p.userName[0]||'?').toUpperCase()}</span><span>${esc(p.userName)} ${p.role==='teacher'?'<b class="teacher">Teacher</b>':''}</span>${role==='teacher'&&p.role!=='teacher'?`<button onclick="removeStudent('${p.socketId}')">Remove</button>`:''}</div>`).join('')}
window.removeStudent=id=>socket.emit('teacher-command',{command:'remove-student',target:id});
socket.on('chat-message',m=>addMessage(m));function addMessage(m){const d=document.createElement('div');d.className='message';d.innerHTML=`<b>${esc(m.userName)}</b><span>${esc(m.message)}</span>`;$('messages').appendChild(d);$('messages').scrollTop=$('messages').scrollHeight}
$('sendBtn').onclick=sendChat;$('chatInput').onkeydown=e=>{if(e.key==='Enter')sendChat()};function sendChat(){const m=$('chatInput').value.trim();if(!m)return;socket.emit('chat-message',{message:m});$('chatInput').value=''}
$('micBtn').onclick=()=>{micOn=!micOn;localStream?.getAudioTracks().forEach(t=>t.enabled=micOn);$('micBtn').querySelector('small').textContent=micOn?'Mute':'Unmute';$('micBtn').classList.toggle('off',!micOn)};
$('cameraBtn').onclick=()=>{cameraOn=!cameraOn;localStream?.getVideoTracks().forEach(t=>t.enabled=cameraOn);$('cameraBtn').querySelector('small').textContent=cameraOn?'Camera':'Camera Off';$('cameraBtn').classList.toggle('off',!cameraOn)};
$('screenBtn').onclick=async()=>{if(!sharing){try{screenStream=await navigator.mediaDevices.getDisplayMedia({video:true});const track=screenStream.getVideoTracks()[0];for(const pc of Object.values(peers)){const sender=pc.getSenders().find(s=>s.track?.kind==='video');if(sender)await sender.replaceTrack(track)};$('localVideo').srcObject=screenStream;sharing=true;$('screenBtn').querySelector('small').textContent='Stop Share';track.onended=stopShare}catch(e){toast('Screen sharing cancelled.')}}else stopShare()};
async function stopShare(){if(!sharing)return;const track=localStream.getVideoTracks()[0];for(const pc of Object.values(peers)){const sender=pc.getSenders().find(s=>s.track?.kind==='video');if(sender)await sender.replaceTrack(track)};screenStream?.getTracks().forEach(t=>t.stop());$('localVideo').srcObject=localStream;sharing=false;$('screenBtn').querySelector('small').textContent='Share'}
function openPanel(type){show($('sidePanel'));if(type==='chat'){hide($('participantsPanel'));show($('chatPanel'));$('panelTitle').textContent='Class Chat'}else{show($('participantsPanel'));hide($('chatPanel'));$('panelTitle').textContent='Participants'}}
$('peopleBtn').onclick=()=>openPanel('people');$('chatBtn').onclick=()=>openPanel('chat');$('closePanel').onclick=()=>hide($('sidePanel'));
$('copyRoomBtn').onclick=()=>copy(roomId);async function copy(t){try{await navigator.clipboard.writeText(t);toast('Class ID copied')}catch(e){toast(t)}}
$('leaveBtn').onclick=leave;function leave(){socket.emit('leave-class');cleanup();hide($('classScreen'));show($('landing'))}
$('endBtn').onclick=()=>{if(confirm('End this live class for everyone?'))socket.emit('teacher-command',{command:'end-class'})};
socket.on('class-ended',()=>{toast('Class has ended');cleanup();hide($('classScreen'));hide($('waiting'));show($('landing'))});socket.on('removed-by-teacher',()=>{toast('You were removed from the class');cleanup();hide($('classScreen'));show($('landing'))});socket.on('join-error',m=>{$('setupError').textContent=m;hide($('waiting'));show($('setup'));show(role==='teacher'?$('teacherSetup'):$('studentSetup'))});
function cleanup(){stopShare();localStream?.getTracks().forEach(t=>t.stop());localStream=null;Object.keys(peers).forEach(removeVideo);$('videoGrid').innerHTML='';roomId='';}
function esc(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
