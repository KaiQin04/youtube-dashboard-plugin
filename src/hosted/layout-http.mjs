/** Same-origin browser transport. Plugin panels supply a host-tool transport. */
export function requestLayout(body) {
 return fetch('/api/analytics/layout',{method:body===undefined?'GET':'POST',cache:'no-store',credentials:'same-origin',headers:body===undefined?{Accept:'application/json'}:{'Content-Type':'application/json',Accept:'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
