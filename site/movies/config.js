// 登录与云端同步的配置。
// 留空（null）时，页面不显示“登录”按钮，标记只保存在当前浏览器里。
// 要开启登录：在 Firebase 控制台 → 项目设置 → “你的应用” → Web 应用里复制 firebaseConfig，
// 替换下面的 null。这段配置本来就是公开的，可以放心提交；
// 数据安全靠的是 Firestore 规则和授权域名（见 README）。
//
// window.PIANDAN_FIREBASE = {
//   apiKey: '...',
//   authDomain: 'your-project.firebaseapp.com',
//   projectId: 'your-project',
//   appId: '...',
// };
window.PIANDAN_FIREBASE = null;
