import Fastify from 'fastify';
import socketioServer from 'fastify-socket.io';
import fastifyCors from '@fastify/cors';
import {nanoid} from 'nanoid';
import fetch from 'node-fetch'
import { formatTime, getVideo, getAudio } from './util.js';

let settings = {
    fastify:{
        host:"0.0.0.0",
        port:1212
    }
}

let rooms = {},
    waitAMinute = [],
    cacheTrend = { data:[], time:0 };

function getToken() {
    let now = nanoid(6);
    return rooms[now] ? getToken() : now;
}

const fastify = Fastify()
fastify.register(fastifyCors, { 
    methods:["GET", "POST", "PUT", "PATCH", "DELETE"],
    origin:"*" 
})
fastify.register(socketioServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    }
})

fastify.get("/room/create", (req, reply)=>{
    let roomId = getToken();
    rooms[roomId]={
        id:roomId,
        users:[],
        now:{
            index:-1,
            meta:null
        },
        playlist:[]
    };
    reply.send(rooms[roomId])
})

fastify.get("/watch", async (req, reply)=>{
    reply.type("application/json").send(await getAudio(req.query.v))
})

fastify.get("/trending", async (req, reply)=>{
    if((+new Date())-cacheTrend.time>60*60*1000){
        let res = await fetch("https://www.youtube.com/feed/trending");
        if(res.ok){
            let body = await res.text()
            let parse = body.toString().match(/ytInitialData.+{.+;<\/script>/gm);
            if(parse){
                let j = JSON.parse(parse[0].slice(16,parse[0].length-10));
                let rec = j?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.shelfRenderer?.content?.expandedShelfContentsRenderer?.items?.map(vid=>{
                    return {
                        id:vid?.videoRenderer?.videoId,
                        title:vid?.videoRenderer?.title?.runs?.[0]?.text,
                        thumbnail:vid?.videoRenderer?.thumbnail?.thumbnails?.length ? vid?.videoRenderer?.thumbnail?.thumbnails[vid?.videoRenderer?.thumbnail?.thumbnails?.length-1]?.url : null,
                        duration:formatTime(vid?.videoRenderer?.lengthText?.simpleText),
                        channel:{
                            name:vid?.videoRenderer?.ownerText?.runs?.[0]?.text,
                            url:vid?.videoRenderer?.ownerText?.runs?.[0]?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url
                        }
                    }
                })
                if(rec){
                    cacheTrend={
                        data:rec,
                        time:+new Date()
                    };
                }
                reply.send(cacheTrend)
            }
        }else{
            reply.send(cacheTrend)
        }
    }else{
        reply.send(cacheTrend)
    }
})



fastify.ready(async err => {
    if (err) throw err


    fastify.io.on('connect', (socket) => {
        console.info('Socket connected!', socket.id);

        function checkRoom() {
            let roomId = [...socket.rooms][1];
            if(roomId){
                if(rooms[roomId]){
                    return roomId
                }else{
                    socket.emit("error", {message:"Room not found"})
                    return false
                }
            }else{
                socket.emit("error", {message:"Not connected"})
                return false
            }
        }

        // ????????????????
        socket.on("playlist-add", async ({videoId})=>{
            if(waitAMinute.indexOf(socket.id)==-1){
                waitAMinute.push(socket.id);
                let roomId = checkRoom();
                if(roomId){
                    let res = await getVideo(videoId);
                    if(res.error){
                        socket.emit("error", {message:res.error})
                    }else{
                        rooms[roomId].playlist.push(res)
                        fastify.io.sockets.to(roomId).emit("room-info", rooms[roomId])
                    }
                    setTimeout(()=>{
                        waitAMinute.splice(waitAMinute.indexOf(socket.id), 1);
                    },2000)
                }
            }else{
                socket.emit("error", {message:"Wait a minute"})
            }
        })

        socket.on("playlist-remove", async ({index})=>{
            let roomId = checkRoom();
            if(roomId){
                if(rooms[roomId].playlist.length>index){
                    rooms[roomId].playlist.splice(index, 1);
                    fastify.io.sockets.to(roomId).emit("room-info", rooms[roomId])
                }else{
                    socket.emit("error", {message:"ID ?????????????? ???? ??????????????"})
                }
            }
        })

        socket.on("playlist-set", async ({index})=>{
            let roomId = checkRoom();
            if(roomId){
                if(rooms[roomId].playlist.length>index){
                    let find = rooms[roomId].users.find(({id})=>id==socket.id)
                    if(find&&find.perms>0){
                        rooms[roomId].now={
                            index,
                            meta:null
                        };
                        fastify.io.sockets.to(roomId).emit("room-info", rooms[roomId])
                    }else{
                        socket.emit("error", {message:"?? ?????? ?????? ????????"})
                    }
                    
                }else{
                    socket.emit("error", {message:"ID ?????????????? ???? ??????????????"})
                }
            }
        })






        // ??????????????????????????
        socket.on("video-sync", async data=>{
            let roomId = checkRoom();
            if(roomId){
                rooms[roomId].now.meta=data
                fastify.io.sockets.to(roomId).emit("video-sync", {id:socket.id, ...data})
            }
        })





        // ??????
        socket.on("room-message", ({text})=>{
            let roomId = checkRoom();
            if(roomId){
                if(text.length>200){
                    socket.emit("error", {message:"???? ?????????? ????????????"})
                }else{
                    console.log("room-incoming", {id:socket.id, text})
                    fastify.io.sockets.to(roomId).emit("room-incoming", {id:socket.id, text})
                }
            }
        })











        // ??????????????
        socket.on("room-join", ({roomId, username})=>{
            console.log("room-join", socket.id, {roomId, username})
            if(rooms[roomId]){
                rooms[roomId].users.forEach((obj, index)=>{
                    if(obj.id==socket.id||obj.username==username) {
                        rooms[roomId].users.splice(index, 1);
                        if(fastify.io.sockets.sockets.has(obj.id)) fastify.io.sockets.sockets.get(obj.id).disconnect()
                    }
                })
                if(rooms[roomId].users.map(({username})=>username).indexOf(username)==-1){
                    rooms[roomId].users.push({
                        id:socket.id,
                        username:username?username:"User",
                        perms:rooms[roomId].users.length ? 0 : 2
                    })
                    socket.join(roomId)
                    if(rooms[roomId].now.meta) setTimeout(()=>{
                        socket.emit("video-sync", {id:"", ...rooms[roomId].now.meta})
                    },5000)
                    fastify.io.sockets.to(roomId).emit("room-info", rooms[roomId])
                }else{
                    socket.emit("error", {message:"?????? ??????????"})
                }
            }else{
                socket.emit("error", {message:"Room not found"})
            }
        })

        function roomLeave() {
            let roomId = checkRoom();
            if(roomId){
                rooms[roomId].users.forEach((obj, index)=>{
                    if(obj.id==socket.id) {
                        if(obj.perms==2) isAdmin=true;
                        rooms[roomId].users.splice(index, 1)
                    };
                })
                if(rooms[roomId].users.length==0) {
                    rooms[roomId].die=setTimeout(()=>{
                        delete rooms[roomId];
                    },1000*60*5)
                }else{
                    if(isAdmin) setTimeout(()=>{
                        rooms[roomId].users[0].perms=2
                        fastify.io.sockets.to(roomId).emit("room-info", rooms[roomId])
                    },2000)
                }
                socket.leave(roomId)
                fastify.io.sockets.to(roomId).emit("room-info", rooms[roomId])
            }
        }

        socket.on("room-leave", roomLeave)
        socket.on("disconnect", roomLeave)
    })
});

setInterval(()=>{
    Object.keys(rooms).forEach(roomId=>{
        rooms[roomId].users.forEach((obj, index)=>{
            if(!fastify.io.sockets.sockets.has(obj.id)){
                rooms[roomId].users.splice(index, 1);
                if(rooms[roomId].users.length==0) {
                    delete rooms[roomId];
                }else{
                    rooms[roomId].users[0].perms=2
                }
                fastify.io.sockets.to(roomId).emit("room-info", rooms[roomId])
            }
        })
    })
},5000)

fastify.listen(settings.fastify)


