import Fastify from 'fastify';
import socketioServer from 'fastify-socket.io';
import fastifyCors from '@fastify/cors';
import {nanoid} from 'nanoid';
import md5 from 'md5';
import youtubedl from 'youtube-dl-exec';
import fs from 'fs';


function getVideo(id) {
    return new Promise((resolve, reject)=>{
        youtubedl('https://www.youtube.com/watch?v='+id, {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
            addHeader: [
                'referer:youtube.com',
                'user-agent:googlebot'
            ]
        }).then(({id, title, formats, thumbnail})=>{
            let frms = []
            formats.forEach(({vcodec, acodec, width, height, url})=>{
                if(vcodec!="none"&&acodec!="none"){
                    frms.push({width, height, url})
                }
            })
            resolve({id, title, thumbnail, formats:frms })
        }).catch((error)=>{
            console.log(Object.keys(error))
            resolve({error:"Video unavailable"})
        })
    })
}


let settings = {
    fastify:{
        host:"0.0.0.0",
        port:1212
    }
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

let perms = [
    { // user
        add_video:true,
        set_video:false,
        change_time:false,
        set_mod:false,
    },
    { // mod
        add_video:true,
        set_video:true,
        change_time:true,
        set_mod:false,
    },
    { // owner
        add_video:true, // add to playlist
        set_video:true, // set now video
        change_time:true, // set video time
        set_mod:true, // set mod perm
    }
]

let rooms = {}

function getToken() {
    let now = nanoid(6);
    if(rooms[now]){
        return getToken()
    }else{
        return now;
    }
}

fastify.get("/perms", (req, reply)=>{
    reply.send(perms)
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

fastify.ready(err => {
    if (err) throw err

    fastify.io.on('connect', (socket) => {
        console.info('Socket connected!', socket.id);

        socket.on("room-join", ({roomId, username})=>{
            console.log("room-join", socket.id, {roomId, username})
            if(rooms[roomId]){
                rooms[roomId].users.forEach((obj, index)=>{
                    if(obj.id==socket.id||obj.username==username) {
                        rooms[roomId].users.splice(index, 1);
                        if(fastify.io.sockets.sockets.has(obj.id)){
                            fastify.io.sockets.sockets.get(obj.id).disconnect()
                        }
                    }
                })
                if(rooms[roomId].users.map(({username})=>username).indexOf(username)==-1){
                    if(rooms[roomId].users.length){
                        rooms[roomId].users.push({
                            id:socket.id,
                            username:username?username:"User",
                            perms:0
                        })
                    }else{
                        rooms[roomId].users.push({
                            id:socket.id,
                            username:username?username:"Admin",
                            perms:perms.length-1
                        })
                    }
                    socket.join(roomId)
                    if(rooms[roomId].now.meta) setTimeout(()=>{
                        socket.emit("video-sync", {id:"", ...rooms[roomId].now.meta})
                    },5000)
                    fastify.io.sockets.to(roomId).emit("room-info", rooms[roomId])
                }else{
                    socket.emit("error", {message:"Ник занят"})
                }
            }else{
                socket.emit("error", {message:"Room not found"})
            }
        })

        socket.on("room-message", ({text})=>{
            let roomId = [...socket.rooms][1];
            if(roomId){
                if(rooms[roomId]){
                    if(text.length>200){
                        socket.emit("error", {message:"Не спамь мудила"})
                    }else{
                        console.log("room-incoming", {id:socket.id, text})
                        fastify.io.sockets.to(roomId).emit("room-incoming", {id:socket.id, text})
                    }
                    
                }else{
                    socket.emit("error", {message:"Room not found"})
                }
            }else{
                socket.emit("error", {message:"Not connected"})
            }
        })

        socket.on("user-set-name", ({username})=>{
            let roomId = [...socket.rooms][1];
            if(roomId){
                if(rooms[roomId]){
                    rooms[roomId].users.forEach((obj, index)=>{
                        if(obj.id==socket.id) rooms[roomId].users[index].username=username;
                    })
                    fastify.io.sockets.to(roomId).emit("room-info", rooms[roomId])
                }else{
                    socket.emit("error", {message:"Room not found"})
                }
            }else{
                socket.emit("error", {message:"Not connected"})
            }
        })

        socket.on("playlist-add", async ({videoId})=>{
            let roomId = [...socket.rooms][1];
            if(roomId){
                if(rooms[roomId]){
                    let res = await getVideo(videoId);
                    if(res.error){
                        socket.emit("error", {message:res.error})
                    }else{
                        rooms[roomId].playlist.push(res)
                        fastify.io.sockets.to(roomId).emit("room-info", rooms[roomId])
                    }
                }else{
                    socket.emit("error", {message:"Room not found"})
                }
            }else{
                socket.emit("error", {message:"Not connected"})
            }
        })

        socket.on("video-sync", async data=>{
            let roomId = [...socket.rooms][1];
            if(roomId){
                if(rooms[roomId]){
                    rooms[roomId].now.meta=data
                    fastify.io.sockets.to(roomId).emit("video-sync", {id:socket.id, ...data})
                }else{
                    socket.emit("error", {message:"Room not found"})
                }
            }else{
                socket.emit("error", {message:"Not connected"})
            }
        })

        function roomLeave() {
            let roomId = [...socket.rooms][1];
            if(roomId){
                if(rooms[roomId]){
                    rooms[roomId].users.forEach((obj, index)=>{
                        if(obj.id==socket.id) rooms[roomId].users.splice(index, 1);
                    })
                    if(rooms[roomId].users.length==0) {
                        delete rooms[roomId];
                    }else{
                        rooms[roomId].users[0].perms=perms.length-1
                    }
                    socket.leave(roomId)
                    fastify.io.sockets.to(roomId).emit("room-info", rooms[roomId])
                }else{
                    socket.emit("error", {message:"Room not found"})
                }
            }else{
                socket.emit("error", {message:"Not connected"})
            }
        }

        socket.on("room-leave", ()=>{
            roomLeave()
        })

        socket.on("disconnect",()=>{
            roomLeave()
        })
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
                    rooms[roomId].users[0].perms=perms.length-1
                }
                fastify.io.sockets.to(roomId).emit("room-info", rooms[roomId])
            }
        })
    })
},5000)

fastify.listen(settings.fastify)

