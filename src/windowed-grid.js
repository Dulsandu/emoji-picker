'use strict';
// Fixed-height rows with a five-row buffer on each side. Only scroll events
// schedule work; there is no persistent animation loop or per-cell listener.
class WindowedGrid {
  constructor(scroller, grid, create) {
    Object.assign(this,{scroller,grid,create,items:[],columns:8,rowHeight:44,frame:0,start:-1,end:-1,active:0});
    scroller.addEventListener('scroll',()=>this.schedule(),{passive:true});
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(scroller);
  }
  resize(){
    if(!this.scroller.clientHeight)return;
    this.columns=getComputedStyle(this.grid).gridTemplateColumns.split(' ').length;
    this.height=this.scroller.clientHeight;
    this.top=this.grid.getBoundingClientRect().top-this.scroller.getBoundingClientRect().top+this.scroller.scrollTop;
    this.paint(true);
  }
  set(items,reset=true){this.items=items;this.active=0;this.start=-1;this.end=-1;this.grid.replaceChildren();if(reset)this.scroller.scrollTop=0;this.resize();}
  schedule(){if(!this.frame&&!document.hidden)this.frame=requestAnimationFrame(()=>{this.frame=0;this.paint();});}
  paint(force=false){
    const rows=Math.ceil(this.items.length/this.columns),offset=Math.max(0,this.scroller.scrollTop-(this.top||0)),first=Math.max(0,Math.floor(offset/this.rowHeight)-5);
    const start=Math.min(first,Math.max(0,rows-1))*this.columns;
    const end=Math.min(this.items.length,(Math.ceil((offset+(this.height||352))/this.rowHeight)+5)*this.columns);
    if(!force&&start===this.start&&end===this.end)return;
    const focused=this.grid.contains(document.activeElement),old=new Map([...this.grid.children].map(n=>[Number(n.dataset.index),n]));
    this.start=start;this.end=end;
    if(focused&&(this.active<start||this.active>=end))this.active=start;
    for(const [i,node] of old)if(i<start||i>=end)node.remove();
    for(let i=start;i<end;i++){
      let node=old.get(i);if(!node){node=this.create(this.items[i],i);node.dataset.index=i;}
      node.tabIndex=i===this.active?0:-1;
      const position=i-start;if(this.grid.children[position]!==node)this.grid.insertBefore(node,this.grid.children[position]||null);
    }
    this.grid.style.paddingTop=(start/this.columns*this.rowHeight)+'px';
    this.grid.style.paddingBottom=((rows-Math.ceil(end/this.columns))*this.rowHeight)+'px';
    if(focused)this.grid.querySelector(`[data-index="${this.active}"]`)?.focus({preventScroll:true});
  }
  focus(index){
    if(!this.items.length)return;this.active=Math.max(0,Math.min(index,this.items.length-1));
    const y=Math.floor(this.active/this.columns)*this.rowHeight+(this.top||0);
    if(y<this.scroller.scrollTop)this.scroller.scrollTop=y;
    else if(y+this.rowHeight>this.scroller.scrollTop+this.height)this.scroller.scrollTop=y+this.rowHeight-this.height;
    this.paint(true);this.grid.querySelector(`[data-index="${this.active}"]`)?.focus({preventScroll:true});
  }
  suspend(){cancelAnimationFrame(this.frame);this.frame=0;this.observer.disconnect();}
  resume(){this.observer.observe(this.scroller);this.resize();}
}
