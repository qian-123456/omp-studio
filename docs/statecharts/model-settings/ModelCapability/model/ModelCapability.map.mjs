export const readerActions=["PickLevel","PickLow","PickSearch","OverrideLow"];
export function state(v){return `${({chatHigh:"仅支持高思考的对话目标",chatLow:"仅支持低思考的对话目标",search:"搜索服务目标"})[v.toModel]}；${v.level==="high"?"已选高思考":"使用模型默认"}${v.overrideModel!=="none"?"；单行改用低思考模型并清除不支持的等级":""}`;}
export function step(s){return ({PickLevel:"选择目标支持的高思考",PickLow:"改选不支持高思考的对话目标",PickSearch:"改选搜索服务目标",OverrideLow:"单行改选另一对话模型并重新校验等级"})[s]??s;}
