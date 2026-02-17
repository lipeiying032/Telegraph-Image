 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/functions/file/[id].js b/functions/file/[id].js
index c7e7a3b7c954c7e687e63a352816971bb05e12f4..0da2ed39f3a6d976402b8168a9721540b06f5c5d 100644
--- a/functions/file/[id].js
+++ b/functions/file/[id].js
@@ -1,49 +1,45 @@
 export async function onRequest(context) {
     const {
         request,
         env,
         params,
     } = context;
 
     const url = new URL(request.url);
-    let fileUrl = 'https://telegra.ph/' + url.pathname + url.search
-    if (url.pathname.length > 39) { // Path length > 39 indicates file uploaded via Telegram Bot API
-        const formdata = new FormData();
-        formdata.append("file_id", url.pathname);
-
-        const requestOptions = {
-            method: "POST",
-            body: formdata,
-            redirect: "follow"
-        };
-        // /file/AgACAgEAAxkDAAMDZt1Gzs4W8dQPWiQJxO5YSH5X-gsAAt-sMRuWNelGOSaEM_9lHHgBAAMCAANtAAM2BA.png
-        //get the AgACAgEAAxkDAAMDZt1Gzs4W8dQPWiQJxO5YSH5X-gsAAt-sMRuWNelGOSaEM_9lHHgBAAMCAANtAAM2BA
-        console.log(url.pathname.split(".")[0].split("/")[2])
-        const filePath = await getFilePath(env, url.pathname.split(".")[0].split("/")[2]);
-        console.log(filePath)
-        fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
+    let fileUrl = 'https://telegra.ph/' + url.pathname + url.search;
+
+    // 兼容旧的 telegraph 链接，同时优先尝试 Telegram file_id 拉取。
+    // params.id 形如: <file_id>.<ext>
+    const lastDotIndex = params.id.lastIndexOf('.');
+    const fileId = lastDotIndex > 0 ? params.id.slice(0, lastDotIndex) : params.id;
+
+    if (fileId && env.TG_Bot_Token) {
+        const filePath = await getFilePath(env, fileId);
+        if (filePath) {
+            fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
+        }
     }
 
     const response = await fetch(fileUrl, {
         method: request.method,
         headers: request.headers,
         body: request.body,
     });
 
     // If the response is OK, proceed with further checks
     if (!response.ok) return response;
 
     // Log response details
     console.log(response.ok, response.status);
 
     // Allow the admin page to directly view the image
     const isAdmin = request.headers.get('Referer')?.includes(`${url.origin}/admin`);
     if (isAdmin) {
         return response;
     }
 
     // Check if KV storage is available
     if (!env.img_url) {
         console.log("KV storage not available, returning image directly");
         return response;  // Directly return image response, terminate execution
     }
@@ -71,51 +67,51 @@ export async function onRequest(context) {
         Label: record.metadata.Label || "None",
         TimeStamp: record.metadata.TimeStamp || Date.now(),
         liked: record.metadata.liked !== undefined ? record.metadata.liked : false,
         fileName: record.metadata.fileName || params.id,
         fileSize: record.metadata.fileSize || 0,
     };
 
     // Handle based on ListType and Label
     if (metadata.ListType === "White") {
         return response;
     } else if (metadata.ListType === "Block" || metadata.Label === "adult") {
         const referer = request.headers.get('Referer');
         const redirectUrl = referer ? "https://static-res.pages.dev/teleimage/img-block-compressed.png" : `${url.origin}/block-img.html`;
         return Response.redirect(redirectUrl, 302);
     }
 
     // Check if WhiteList_Mode is enabled
     if (env.WhiteList_Mode === "true") {
         return Response.redirect(`${url.origin}/whitelist-on.html`, 302);
     }
 
     // If no metadata or further actions required, moderate content and add to KV if needed
     if (env.ModerateContentApiKey) {
         try {
             console.log("Starting content moderation...");
-            const moderateUrl = `https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=https://telegra.ph${url.pathname}${url.search}`;
+            const moderateUrl = `https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=${encodeURIComponent(fileUrl)}`;
             const moderateResponse = await fetch(moderateUrl);
 
             if (!moderateResponse.ok) {
                 console.error("Content moderation API request failed: " + moderateResponse.status);
             } else {
                 const moderateData = await moderateResponse.json();
                 console.log("Content moderation results:", moderateData);
 
                 if (moderateData && moderateData.rating_label) {
                     metadata.Label = moderateData.rating_label;
 
                     if (moderateData.rating_label === "adult") {
                         console.log("Content marked as adult, saving metadata and redirecting");
                         await env.img_url.put(params.id, "", { metadata });
                         return Response.redirect(`${url.origin}/block-img.html`, 302);
                     }
                 }
             }
         } catch (error) {
             console.error("Error during content moderation: " + error.message);
             // Moderation failure should not affect user experience, continue processing
         }
     }
 
     // Only save metadata if content is not adult content
@@ -130,26 +126,26 @@ export async function onRequest(context) {
 async function getFilePath(env, file_id) {
     try {
         const url = `https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${file_id}`;
         const res = await fetch(url, {
             method: 'GET',
         });
 
         if (!res.ok) {
             console.error(`HTTP error! status: ${res.status}`);
             return null;
         }
 
         const responseData = await res.json();
         const { ok, result } = responseData;
 
         if (ok && result) {
             return result.file_path;
         } else {
             console.error('Error in response data:', responseData);
             return null;
         }
     } catch (error) {
         console.error('Error fetching file path:', error.message);
         return null;
     }
-}
\ No newline at end of file
+}
 
EOF
)


