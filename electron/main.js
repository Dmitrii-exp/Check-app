const {app,BrowserWindow,shell,session}=require('electron');
const path=require('node:path');
const HOME='https://app-check.ru/app/';
function allowed(url){try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='app-check.ru'&&(u.pathname==='/app'||u.pathname.startsWith('/app/'));}catch{return false;}}
function external(url){try{return ['https:','http:'].includes(new URL(url).protocol);}catch{return false;}}
function createWindow(){
 const win=new BrowserWindow({width:1280,height:850,minWidth:840,minHeight:600,title:'Check App',autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
 win.webContents.setWindowOpenHandler(({url})=>{if(external(url))shell.openExternal(url).catch(()=>{});return {action:'deny'};});
 for(const name of ['will-navigate','will-redirect'])win.webContents.on(name,(event,url)=>{if(!allowed(url)){event.preventDefault();if(external(url))shell.openExternal(url).catch(()=>{});}});
 win.webContents.on('did-fail-load',(_e,code,_desc,_url,isMainFrame)=>{if(isMainFrame&&code!==-3)win.loadFile(path.join(__dirname,'offline.html')).catch(()=>{});});
 win.loadURL(HOME).catch(()=>win.loadFile(path.join(__dirname,'offline.html')));
}
app.whenReady().then(()=>{session.defaultSession.setPermissionRequestHandler((_wc,permission,callback,details)=>callback(permission==='notifications'&&allowed(details?.requestingUrl||'')));createWindow();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
