const socket = io();
const $ = id => document.getElementById(id);
let mode = '', role = '', roomId = '', userName = '', className = '';
let localStream = null, screenStream = null, sharing = false, micOn = false, cameraOn = false, handRaised = false, speakingAllowed = false, mutedByTeacher = false;
const peers = {}, remoteMeta = {};
let participantState = new Map();
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
async function joinClass(){
  hide($('landing'));hide($('setup'));hide($('waiting'));show($('classScreen'));
  $('currentRoom').textContent=roomId;$('classTitle').textContent=className||'Live Class';
  if(role==='teacher'){show($('endBtn')); speakingAllowed=true;}else {hide($('endBtn')); speakingAllowed=true;}
  updateRaiseHandButton();

  // Camera and microphone are OPTIONAL. The class can be joined even when
  // the desktop has no camera/mic or the user denies permission.
  await tryGetMedia();
  addLocalVideo();
  socket.emit('join-class',{roomId,userName,role});
}

async function tryGetMedia(){
  if(!navigator.mediaDevices?.getUserMedia){
    micOn=false; cameraOn=false; updateMediaButtons(); return;
  }
  try{
    localStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});
    cameraOn=localStream.getVideoTracks().length>0;
    micOn=localStream.getAudioTracks().length>0;
    if(role==='student' && mutedByTeacher){ localStream.getAudioTracks().forEach(t=>t.enabled=false); micOn=false; }
  }catch(e){
    // If both are unavailable/denied, silently continue without media.
    localStream=null; cameraOn=false; micOn=false;
    toast('Joining without camera/microphone');
  }
  updateMediaButtons();
}

async function enableMedia(kind){
  if(!navigator.mediaDevices?.getUserMedia){toast('Camera/microphone is not available in this browser.');return;}
  try{
    const constraints=kind==='camera'?{video:true,audio:false}:{video:false,audio:true};
    const stream=await navigator.mediaDevices.getUserMedia(constraints);
    if(!localStream)localStream=new MediaStream();
    stream.getTracks().forEach(track=>localStream.addTrack(track));
    if(kind==='camera')cameraOn=true; else { if(role==='student' && mutedByTeacher){ stream.getAudioTracks().forEach(t=>t.enabled=false); micOn=false; } else micOn=true; }
    if($('localVideo'))$('localVideo').srcObject=localStream;
    for(const pc of Object.values(peers)){
      stream.getTracks().forEach(track=>pc.addTrack(track,localStream));
    }
    updateMediaButtons();
  }catch(e){toast((kind==='camera'?'Camera':'Microphone')+' permission not available. You can continue without it.');}
}

function updateMediaButtons(){
  const mic=$('micBtn'), cam=$('cameraBtn');
  if(mic){mic.querySelector('small').textContent=micOn?'Mute':'Enable Mic';mic.classList.toggle('off',!micOn)}
  if(cam){cam.querySelector('small').textContent=cameraOn?'Camera':'Enable Camera';cam.classList.toggle('off',!cameraOn)}
}
function addLocalVideo(){const box=document.createElement('div');box.className='video-card local';box.id='localCard';box.innerHTML=`<video id="localVideo" autoplay muted playsinline></video><div class="name-tag">${esc(userName)} <b>YOU</b></div><div class="hand-badge hidden">🙋 Hand Raised</div>`;$('videoGrid').appendChild(box);if(localStream)$('localVideo').srcObject=localStream;updateMediaButtons();updateHandCard(socket.id, handRaised)}
function addRemoteVideo(id,name,r='student'){remoteMeta[id]={name,role:r,handRaised:participantState.get(id)?.handRaised||false};let card=document.getElementById('v-'+id);if(card)return;card=document.createElement('div');card.className='video-card';card.id='v-'+id;card.innerHTML=`<video id="video-${id}" autoplay playsinline></video><div class="name-tag">${esc(name)} ${r==='teacher'?'<b>TEACHER</b>':''}</div><div class="hand-badge hidden">🙋 Hand Raised</div>`;$('videoGrid').appendChild(card);updateHandCard(id,remoteMeta[id].handRaised)}
function removeVideo(id){document.getElementById('v-'+id)?.remove();delete remoteMeta[id];if(peers[id]){peers[id].close();delete peers[id]}}
function makePeer(id,initiator){const pc=new RTCPeerConnection(rtc);if(localStream)localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));pc.onicecandidate=e=>{if(e.candidate)socket.emit('ice-candidate',{target:id,candidate:e.candidate})};pc.ontrack=e=>{addRemoteVideo(id,remoteMeta[id]?.name||'Participant',remoteMeta[id]?.role);$('video-'+id).srcObject=e.streams[0]};pc.onconnectionstatechange=()=>{if(['failed','closed','disconnected'].includes(pc.connectionState)) removeVideo(id)};peers[id]=pc;if(initiator){pc.createOffer().then(o=>pc.setLocalDescription(o)).then(()=>socket.emit('offer',{target:id,offer:pc.localDescription}))}return pc}
socket.on('class-state',async s=>{className=s.className;$('classTitle').textContent=className;participantState=new Map((s.participants||[]).map(p=>[p.socketId,p]));s.existingUsers.forEach(u=>{remoteMeta[u.socketId]={name:u.userName,role:u.role,handRaised:participantState.get(u.socketId)?.handRaised||false};makePeer(u.socketId,true);addRemoteVideo(u.socketId,u.userName,u.role)});updateParticipants(s.participants)});
socket.on('user-joined',u=>{remoteMeta[u.socketId]={name:u.userName,role:u.role,handRaised:false};addRemoteVideo(u.socketId,u.userName,u.role);});
socket.on('offer',async({sender,offer,userName:name,role:r})=>{remoteMeta[sender]={name,role:r};addRemoteVideo(sender,name,r);const pc=peers[sender]||makePeer(sender,false);await pc.setRemoteDescription(offer);const a=await pc.createAnswer();await pc.setLocalDescription(a);socket.emit('answer',{target:sender,answer:pc.localDescription})});
socket.on('answer',async({sender,answer})=>{if(peers[sender])await peers[sender].setRemoteDescription(answer)});
socket.on('ice-candidate',async({sender,candidate})=>{if(peers[sender])try{await peers[sender].addIceCandidate(candidate)}catch(e){}});
socket.on('user-left',id=>removeVideo(id));
socket.on('participants',updateParticipants);
function updateParticipants(list=[]){
  participantState=new Map(list.map(p=>[p.socketId,p]));
  list.forEach(p=>{ if(p.socketId===socket.id) handRaised=!!p.handRaised; if(remoteMeta[p.socketId]) remoteMeta[p.socketId].handRaised=!!p.handRaised; updateHandCard(p.socketId,!!p.handRaised); });
  updateRaiseHandButton();
  $('participantsPanel').innerHTML=list.map(p=>{
    const hand=p.handRaised?' hand-raised':'';
    let actions='';
    if(role==='teacher' && p.role!=='teacher'){
      if(p.handRaised) actions+=`<span class="hand-actions"><button onclick="allowSpeak('${p.socketId}')">Allow</button><button class="deny" onclick="denySpeak('${p.socketId}')">Deny</button></span>`;
      actions+=`<button onclick="${p.mutedByTeacher?'unmuteStudent':'muteStudent'}('${p.socketId}')">${p.mutedByTeacher?'Unmute':'Mute'}</button>`;
      actions+=`<button onclick="removeStudent('${p.socketId}')">Remove</button>`;
    }
    return `<div class="participant${hand}"><span class="avatar">${esc(p.userName[0]||'?').toUpperCase()}</span><span>${esc(p.userName)} ${p.role==='teacher'?'<b class=teacher>Teacher</b>':''}${p.handRaised?' 🙋':''}</span>${actions}</div>`;
  }).join('')
}
window.removeStudent=id=>socket.emit('teacher-command',{command:'remove-student',target:id});
window.allowSpeak=id=>socket.emit('teacher-command',{command:'allow-speak',target:id});
window.denySpeak=id=>socket.emit('teacher-command',{command:'deny-speak',target:id});
window.muteStudent=id=>socket.emit('teacher-command',{command:'mute-student',target:id});
window.unmuteStudent=id=>socket.emit('teacher-command',{command:'unmute-student',target:id});
$('raiseHandBtn').onclick=()=>{ if(role==='teacher'){toast('Teacher does not need to raise hand.');return;} handRaised=!handRaised; socket.emit('raise-hand',{raised:handRaised}); updateRaiseHandButton(); };
function updateRaiseHandButton(){ const b=$('raiseHandBtn'); if(!b)return; b.classList.toggle('hand',handRaised); b.querySelector('small').textContent=handRaised?'Lower Hand':'Raise Hand'; updateHandCard(socket.id,handRaised); }
function updateHandCard(id,raised){ const card=document.getElementById(id==='local'? 'localCard' : 'v-'+id); if(!card)return; const badge=card.querySelector('.hand-badge'); if(badge)badge.classList.toggle('hidden',!raised); card.classList.toggle('hand-raised-card',!!raised); }

socket.on('speaking-permission', ({allowed})=>{
  speakingAllowed=!!allowed;
  if(role==='student' && localStream) localStream.getAudioTracks().forEach(t=>t.enabled=!!allowed && !mutedByTeacher && micOn);
  if(speakingAllowed){ handRaised=false; updateRaiseHandButton(); }
});

socket.on('teacher-mic-state', ({muted})=>{
  if(role!=='student') return;
  mutedByTeacher=!!muted;
  if(mutedByTeacher){
    micOn=false;
    localStream?.getAudioTracks().forEach(t=>t.enabled=false);
    toast('Teacher muted your microphone.');
  } else {
    micOn=true;
    localStream?.getAudioTracks().forEach(t=>t.enabled=true);
    toast('Teacher unmuted your microphone.');
  }
  updateMediaButtons();
});
socket.on('hand-update', ({socketId,userName:name,raised})=>{ if(remoteMeta[socketId]) remoteMeta[socketId].handRaised=!!raised; updateHandCard(socketId,!!raised); if(socketId===socket.id){handRaised=!!raised;updateRaiseHandButton();} if(role==='teacher' && raised) toast(`${name} raised a hand.`); });
socket.on('chat-message',m=>addMessage(m));function addMessage(m){const d=document.createElement('div');d.className='message';d.innerHTML=`<b>${esc(m.userName)}</b><span>${esc(m.message)}</span>`;$('messages').appendChild(d);$('messages').scrollTop=$('messages').scrollHeight}
$('sendBtn').onclick=sendChat;$('chatInput').onkeydown=e=>{if(e.key==='Enter')sendChat()};function sendChat(){const m=$('chatInput').value.trim();if(!m)return;socket.emit('chat-message',{message:m});$('chatInput').value=''}
$('micBtn').onclick=async()=>{if(role==='student' && mutedByTeacher){toast('Teacher has muted your microphone.');return;}if(!localStream?.getAudioTracks().length){await enableMedia('mic');return;}micOn=!micOn;localStream.getAudioTracks().forEach(t=>t.enabled=micOn && !mutedByTeacher);updateMediaButtons()};
$('cameraBtn').onclick=async()=>{if(!localStream?.getVideoTracks().length){await enableMedia('camera');return;}cameraOn=!cameraOn;localStream.getVideoTracks().forEach(t=>t.enabled=cameraOn);updateMediaButtons()};
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

<script id="double-click-fullscreen-handler">
(function doubleClickFullscreenHandler(){
  function toggleFullscreen(el){
    if (!el) return;
    const current = document.fullscreenElement;
    if (current) {
      document.exitFullscreen?.().catch(()=>{});
      return;
    }
    if (el.requestFullscreen) {
      el.requestFullscreen({navigationUI:"hide"}).catch(()=>{
        el.classList.add("double-click-fullscreen");
      });
    } else {
      el.classList.add("double-click-fullscreen");
    }
  }

  document.addEventListener("dblclick", function(e){
    const target = e.target;
    if (!target) return;

    // Prefer video/participant/card elements.
    const el = target.closest("video, .participant-card, .video-card, .participant, .tile, .video-tile");
    if (el) {
      e.preventDefault();
      toggleFullscreen(el);
    }
  }, true);

  document.addEventListener("fullscreenchange", function(){
    if (!document.fullscreenElement) {
      document.querySelectorAll(".double-click-fullscreen")
        .forEach(el => el.classList.remove("double-click-fullscreen"));
    }
  });
})();
</script>
