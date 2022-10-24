import youtubedl from 'youtube-dl-exec';
import Lamejs from 'lamejs';

const lame = new Lamejs();

export function formatTime(time) {
    if(!time) return 0;
    let spl = time.split(":"),
        sum = 0;
    for(let i=spl.length-1;i>=0;i--){
        sum+=spl[i]*Math.pow(60, i)
    }
    return sum
}

export function getVideo(id) {
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
        }).then(({id, title, formats, thumbnail, channel, channel_url, duration})=>{
            let frms = []
            formats.forEach(({vcodec, acodec, width, height, url})=>{
                if(vcodec!="none"&&acodec!="none"){
                    frms.push({width, height, url})
                }
            })
            resolve({id, title, thumbnail, formats:frms, channel:{name:channel, url:channel_url}, duration })
        }).catch((error)=>{
            console.log(Object.keys(error))
            resolve({error:"Video unavailable"})
        })
    })
}

export function getAudio(id) {
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
        }).then(({formats})=>{
            let frms=[],
                mQ = Math.max(...formats.map(({quality, vcodec, acodec})=>{return vcodec=="none"&&acodec!="none" ? quality : 0}));
            formats.forEach((data)=>{
                if(data.vcodec=="none"&&data.acodec=="opus"&&data.quality==mQ){
                    frms.push(data)
                }
            })
            if(frms.length){
                let mp3enc = new lib.Mp3Encoder(frms[0].audio_channels, frms[0].asr, 128);
            }
            resolve(frms)
        }).catch((error)=>{
            console.log(error)
            resolve({error:"Video unavailable"})
        })
    })
}