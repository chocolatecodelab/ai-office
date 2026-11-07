export function isChatVideo(file:{mime?:string;name:string}){
  return file.mime?.startsWith('video/')??/\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name)
}
