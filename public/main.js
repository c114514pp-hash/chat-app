// public/main.js

// -------------------- 初期設定 --------------------
const socket = io(location.origin);
let token = localStorage.getItem('token');
let username = localStorage.getItem('username');
let userId = localStorage.getItem('userId');
let offset = 0, limit = 50, loading = false, searchTerm = '';

// DOM
const chatArea = document.getElementById('chatArea');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const fileInput = document.getElementById('fileInput');
const typingDiv = document.getElementById('typing');
const userCountDiv = document.getElementById('userCount');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');

// -------------------- ログイン --------------------
async function login(){
  if(!token){
    username = prompt('Username');
    const password = prompt('Password');
    const res = await fetch('/api/login',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username,password})
    });
    const data = await res.json();
    if(data.success){
      token = data.token;
      userId = data.userId;
      localStorage.setItem('token', token);
      localStorage.setItem('username', username);
      localStorage.setItem('userId', userId);
    } else alert('Login failed');
  }
}
login();

// -------------------- メッセージ送信 --------------------
sendBtn.onclick = async () => {
  if(!messageInput.value && !fileInput.files[0]) return;
  const formData = new FormData();
  formData.append('text', messageInput.value);
  if(fileInput.files[0]) formData.append('file', fileInput.files[0]);
  await fetch('/api/message',{ method:'POST', body:formData, headers:{'Authorization': token} });
  messageInput.value = '';
  fileInput.value = '';
};

// -------------------- WebSocket --------------------
socket.on('new_message', msg => addMessage(msg));
socket.on('edit_message', msg => {
  const el=document.getElementById('msg_'+msg.id);
  if(el) el.querySelector('.text').textContent=msg.text;
});
socket.on('delete_message', id=>{
  const el=document.getElementById('msg_'+id);
  if(el) el.remove();
});
socket.on('user_count', count => userCountDiv.textContent = count);

// タイピング通知
messageInput.addEventListener('input', () => socket.emit('typing', username));
socket.on('typing', name => {
  typingDiv.textContent = `${name} is typing...`;
  setTimeout(()=>{ typingDiv.textContent = ''; }, 1500);
});

// -------------------- 過去ログ取得 & 無限スクロール --------------------
async function loadMessages(reset=false){
  if(loading) return;
  loading = true;
  if(reset){ offset=0; chatArea.innerHTML=''; }
  const res = await fetch(`/api/messages?offset=${offset}&limit=${limit}&search=${searchTerm}`,{ headers:{'Authorization':token}});
  const msgs = await res.json();
  msgs.forEach(msg=>addMessage(msg,true));
  offset += msgs.length;
  loading=false;
}

chatArea.addEventListener('scroll', ()=>{
  if(chatArea.scrollTop<50) loadMessages();
});

// -------------------- メッセージ描画 --------------------
function addMessage(msg, prepend=false){
  const div = document.createElement('div');
  div.id = 'msg_'+msg.id;
  div.className = 'message '+(msg.user_id==userId?'self':'other');
  div.innerHTML = `<b>${msg.username}</b>: <span class="text">${msg.text}</span> <small>${new Date(msg.created_at).toLocaleTimeString()}</small>`;

  if(msg.file){
    const ext = msg.file.split('.').pop().toLowerCase();
    if(['jpg','jpeg','png','gif','webp'].includes(ext)){
      div.innerHTML += `<br><img src="${msg.file}" class="w-32 rounded"/>`;
    } else {
      div.innerHTML += `<br><a href="${msg.file}" target="_blank" class="underline">${msg.file.split('/').pop()}</a>`;
    }
  }

  if(msg.user_id==userId){
    div.innerHTML += `<br><button onclick="editMsg(${msg.id})" class="edit">Edit</button>
                      <button onclick="deleteMsg(${msg.id})" class="delete">Del</button>`;
  }

  if(prepend) chatArea.prepend(div); else chatArea.appendChild(div);
}

// -------------------- 編集/削除 --------------------
window.editMsg = async id => {
  const newText = prompt('Edit message');
  if(!newText) return;
  await fetch('/api/message/'+id,{
    method:'PUT',
    headers:{'Content-Type':'application/json','Authorization': token},
    body:JSON.stringify({text:newText})
  });
};

window.deleteMsg = async id => {
  await fetch('/api/message/'+id,{
    method:'DELETE',
    headers:{'Authorization': token}
  });
};

// -------------------- 検索 --------------------
searchBtn.onclick = () => {
  searchTerm = searchInput.value;
  loadMessages(true);
};

// -------------------- 初回ロード --------------------
window.onload = () => loadMessages();
