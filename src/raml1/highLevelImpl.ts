/// <reference path="../../typings/main.d.ts" />

import defs=require("raml-definition-system")
import hl=require("./highLevelAST")
import ll=require("./lowLevelAST")
import _=require("underscore")
import proxy=require("./ast.core/LowLevelASTProxy")
import def=defs;
import high=require("./highLevelAST");
import builder=require("./ast.core/builder")
import search=require("./ast.core/search")
import mutators=require("./ast.core/mutators")
import linter=require("./ast.core/linter")
import expander=require("./ast.core/expander")
import typeBuilder=require("./ast.core/typeBuilder")
import universes=require("./tools/universe")
import jsyaml=require("./jsyaml/jsyaml2lowLevel")
import textutil=require('../util/textutil')
import ParserCore = require("./wrapped-ast/parserCore")
import services=def
import yaml=require("yaml-ast-parser")
import core=require("./wrapped-ast/parserCore");
import factory10 = require("./artifacts/raml10factory")
import factory08 = require("./artifacts/raml08factory")
import universeHelpers = require("./tools/universeHelpers")
import resourceRegistry = require("./jsyaml/resourceRegistry")
import rTypes=defs.rt;
type NodeClass=def.NodeClass;
type IAttribute=high.IAttribute

import contentprovider = require('../util/contentprovider')
type IHighLevelNode=hl.IHighLevelNode
export function qName(x:hl.IHighLevelNode,context:hl.IHighLevelNode):string{
    //var dr=search.declRoot(context);
    var nm=x.name();
    if (x.lowLevel().unit()!=context.lowLevel().unit()){
        var root:BasicASTNode=<BasicASTNode><any>context;
        while (true) {
            if (root.lowLevel().includePath()||root.parent()==null) {
                if (!root.unitMap) {
                    root.unitMap = {};
                    root.asElement().elements().forEach(x=> {
                        if (x.definition().key() == universes.Universe10.UsesDeclaration) {
                            var mm = x.attr("value");
                            if (mm) {
                                var unit = root.lowLevel().unit().resolve(mm.value());
                                if (unit != null) {
                                    var key = x.attr("key");
                                    if (key) {
                                        root.unitMap[unit.absolutePath()] = key.value();
                                    }
                                }
                            }
                        }
                    });
                }
                var prefix = root.unitMap[x.lowLevel().unit().absolutePath()];
                if (prefix) {
                    return prefix + "." + nm;
                }
            }
            if (!root.parent()){
                break;
            }
            else {
                root = <BasicASTNode><any>root.parent();
            }
        }
    }
    return nm;
}

export class BasicASTNode implements hl.IParseResult {
    private _hashkey : string;

    unitMap:{ [path:string]:string };

    

    getKind() : hl.NodeKind {
        return hl.NodeKind.BASIC
    }
    asAttr():hl.IAttribute{
        return null;
    }
    asElement():hl.IHighLevelNode{
        return null;
    }
    hashkey() {
        if (!this._hashkey) this._hashkey = this.parent() ? this.parent().hashkey() + "/" + this.name() : this.name(); 
        return this._hashkey;
    }
    
    root():hl.IHighLevelNode{
        if (this.parent()){
            return this.parent().root();
        }
        return <any>this;
    }

    version(){
        return "";
    }

    getLowLevelStart() {
        if(this.lowLevel().kind() === jsyaml.Kind.SCALAR) {
            return this.lowLevel().start();
        }

        return this.lowLevel().keyStart();
    }

    getLowLevelEnd() {
        if(this.lowLevel().kind() === jsyaml.Kind.SCALAR) {
            return this.lowLevel().end();
        }

        return this.lowLevel().keyEnd();
    }

    private _implicit:boolean=false;
    private values:{[name:string]:any}={}
    _computed:boolean;
    constructor(protected _node:ll.ILowLevelASTNode,private _parent:hl.IHighLevelNode){
        if(_node) {
            _node.setHighLevelParseResult(this);
        }
    }
    knownProperty:hl.IProperty
    needSequence:boolean
    needMap:boolean
    unresolvedRef:string
    errorMessage: string

    isSameNode(n:hl.IParseResult){
        if (n) {
            if (n.lowLevel().actual() == this.lowLevel().actual()) {
                return true;
            }
        }
        return false;
    }
    checkContextValue(name:string,value:string,thisObj:any):boolean{
        var vl=this.computedValue(name);
        if (vl&&vl.indexOf(value)!=-1){
            return true;//FIXME
        }

        return value==vl||value=='false';
    }

    printDetails(indent?:string) : string {
        return (indent? indent : "")+"Unkown\n";
    }

    /**
     * Used for test comparison of two trees. Touching this will require AST tests update.
     * @param indent
     * @returns {string}
     */
    testSerialize(indent?:string) : string {
        return (indent? indent : "")+"Unkown\n";
    }

    errors():hl.ValidationIssue[]{
        var errors:hl.ValidationIssue[]=[];
        var q:hl.ValidationAcceptor={
            accept(c:hl.ValidationIssue){
                errors.push(c);
            },
            begin(){

            },
            end(){

            }
        }
        this.validate(q);
        return errors;
    }

    markCh() {
        var n:any = this.lowLevel();
        n = n._node ? n._node : n;
        if (n['markCh']) {
            return true;
        }
        n['markCh'] = 1;
    }

    unmarkCh(){
        var n:any=this.lowLevel();
        n=n._node?n._node:n;
        delete n['markCh'];
    }

    validate(v:hl.ValidationAcceptor):void{

        linter.validate(this,v);
    }
    allowRecursive(){
        return false;
    }


    setComputed(name:string,v:any){
        this.values[name]=v;
    }

    computedValue(name:string):any{
        var vl=this.values[name];
        if (!vl&&this.parent()){
            return this.parent().computedValue(name)
        }
        return vl;
    }

    lowLevel():ll.ILowLevelASTNode {
        return this._node;
    }


    name(){
        var c=this.lowLevel().key();
        if (!c){
            return "";
        }
        return c;
    }

    optional():boolean{
        var llNode = this.lowLevel();
        var ownValue = llNode.optional();
        if(llNode.key()!=null ){
            return ownValue;
        }

        var p = this.property();
        if(!p||!p.isMultiValue()) {
            return ownValue;
        }
        var llParent = llNode.parent();
        while(llParent&&llParent.highLevelNode()==null){
            if(llParent.kind()==yaml.Kind.MAPPING){
                return llParent.optional();
            }
            llParent = llParent.parent();
        }
        return ownValue;
    }

    parent():hl.IHighLevelNode {
        return this._parent;
    }
    
    setParent(parent: hl.IHighLevelNode) {
        this._parent = parent;
    }
    
    isElement(){
        return false;
    }
    directChildren():hl.IParseResult[] {
        return this.children();
    }

    children():hl.IParseResult[] {
        return [];
    }

    isAttached():boolean {
        return this.parent()!=null;
    }

    isImplicit():boolean {
        return this._implicit;
    }

    isAttr():boolean{
        return false;
    }
    isUnknown():boolean{
        return true;
    }
    id():string{
        if (this.cachedId){
            return this.cachedId;
        }
        if (this._parent){
            var parentId=this.parent().id();
            parentId+="."+this.name();
            var sameName=(<BasicASTNode><any>this.parent()).directChildren().filter(x=>x.name()==this.name());
            if (sameName.length>1){
                var ind=sameName.indexOf(this);
                parentId+="["+ind+"]"
            }
            this.cachedId=parentId;
            return parentId;
        }
        this.cachedId= "";
        return this.cachedId;
    }

    localId():string{
        return this.name();
    }
    cachedId: string
    cachedFullId: string

    fullLocalId() : string {
        if (this.cachedFullId){
            return this.cachedFullId;
        }
        if (this._parent){
            var result="."+this.name();

            var sameName=(<BasicASTNode><any>this.parent()).directChildren().filter(x=>x.name()==this.name());
            if (sameName.length>1){
                var ind=sameName.indexOf(this);
                result+="["+ind+"]"
            }
            this.cachedFullId=result;
            return result;
        }
        this.cachedFullId= this.localId();
        return this.cachedFullId;
    }

    property():hl.IProperty{
        return null;
    }
}


export class StructuredValue implements hl.IStructuredValue{

    private _pr:def.Property
    constructor(private node:ll.ILowLevelASTNode,private _parent:hl.IHighLevelNode,_pr:hl.IProperty,private kv=null){
        this._pr=<def.Property>_pr;
    }

    valueName(): string {
        var res:string=null;
        if (this.kv){
            res=this.kv;
        }
        res=this.node.key();
        if (this._pr&&this._pr.isAnnotation()){
            if (res&&res.charAt(0)=='('){
                res=res.substring(1,res.length-1);
            }
        }
        return res;
    }

    children():StructuredValue[]{
        return this.node.children().map(x=>new StructuredValue(x,null,null));
    }

    lowLevel():ll.ILowLevelASTNode{
        return this.node;
    }

    private _hl:hl.IHighLevelNode;



    toHighLevel(parent?: hl.IHighLevelNode):hl.IHighLevelNode{
        if (!parent && this._parent) parent = this._parent;
        if (this._hl){
            return this._hl;
        }
        var vn=this.valueName();
        var cands=search.referenceTargets(this._pr, parent).filter(x=>qName(x,parent)==vn);
        if (cands&&cands[0]){
            var tp=(<hl.IHighLevelNode>cands[0]).localType();
            var node=new ASTNodeImpl(this.node,parent,<hl.INodeDefinition>tp,this._pr);
            if (this._pr){
                this._pr.childRestrictions().forEach(y=>{
                    node.setComputed(y.name,y.value)
                })
            }
            this._hl=node;
            return node;
        }
        //if (this._pr.range()){
        //    var node=new ASTNodeImpl(parent.lowLevel(),parent,this._pr.range(),this._pr);
        //    if (this._pr){
        //        this._pr.childRestrictions().forEach(y=>{
        //            node.setComputed(y.name,y.value)
        //        })
        //    }
        //    return node;
        //}
        return null;
    }

    toHighLevel2(parent?: hl.IHighLevelNode):hl.IHighLevelNode{
        if (!parent && this._parent) parent = this._parent;
        var vn=this.valueName();
        var cands=search.referenceTargets(this._pr,parent).filter(x=>qName(x,parent)==vn);
        if (cands&&cands[0]){
            var tp=(<hl.IHighLevelNode>cands[0]).localType();
            var node=new ASTNodeImpl(this.node,parent,<hl.INodeDefinition>tp,this._pr);
            if (this._pr){
                this._pr.childRestrictions().forEach(y=>{
                    node.setComputed(y.name,y.value)
                })
            }
            return node;
        }
        if (this._pr.range()){
            var node=new ASTNodeImpl(this.node.parent(),parent,this._pr.range(),this._pr);
            if (this._pr){
                this._pr.childRestrictions().forEach(y=>{
                    node.setComputed(y.name,y.value)
                })
            }
            return node;
        }
        return null;
    }
}



export class ASTPropImpl extends BasicASTNode implements  hl.IAttribute {


    definition():hl.IValueTypeDefinition {
        return this._def;
    }
    asAttr():hl.IAttribute{
        return this;
    }

    errors():hl.ValidationIssue[]{
        var errors:hl.ValidationIssue[]=[];
        var q:hl.ValidationAcceptor={
            accept(c:hl.ValidationIssue){
                if (c.node===this) {
                    errors.push(c);
                }
            },
            begin(){

            },
            end(){

            }
        }
        this.parent().validate(q);
        return errors;
    }

    isString(){
        if (this._def) {
            if (this._def.key() === universes.Universe08.StringType || this._def.key() == universes.Universe10.StringType) {
                return true;
            }
        }
        return false;
    }
    isAnnotatedScalar(){
        if (!this.property().isAnnotation()&&!this.property().isKey()) {
            return this.lowLevel().isAnnotatedScalar();
        }
        return false;
    }


    annotations():hl.IAttribute[]{
        var ch = this.lowLevel().children();
        var annotations:hl.IAttribute[] = [];
        var u = this.definition().universe().type(universes.Universe10.Annotable.name);
        if (!u) {
            return annotations;
        }
        var pr = u.property("annotations");
        for (var i = 0; i < ch.length; i++) {
            var child = ch[i];
            var key = child.key();
            if (key != null && key[0] == ("(") && key[key.length - 1] == (")")) {
                var attr = new ASTPropImpl(child, this.parent(), pr.range(), pr);
                annotations.push(attr);
            }
        }
        return annotations;
    }

    constructor(node:ll.ILowLevelASTNode, parent:hl.IHighLevelNode, private _def:hl.IValueTypeDefinition, private _prop:hl.IProperty, private fromKey:boolean = false) {
        super(node, parent)

    }

    getKind() : hl.NodeKind {
        return hl.NodeKind.ATTRIBUTE
    }

    owningWrapper():{node:ParserCore.BasicNode; property:string}{
        return {
            node: this.parent().wrapperNode(),
            property: this.name()
        };
    }

    patchType(t:hl.IValueTypeDefinition){
        this._def=t;
    }


    findReferenceDeclaration():hl.IHighLevelNode{
        var targets=search.referenceTargets(this.property(),this.parent());
        var vl=this.value();
        if (vl instanceof StructuredValue){
            var st=<StructuredValue>vl;
            var nm=st.valueName();
        }
        else{
            var nm=""+vl;
        }
        var t:hl.IHighLevelNode=_.find(targets,x=>qName(x,this.parent())==nm)
        return t;
    }
    findReferencedValue(){
        var c=this.findReferenceDeclaration();
        if (c){
            var vl=c.attr("value");
            var ck=c.definition().key();
            if (ck===universes.Universe08.GlobalSchema) {
                if (vl) {
                    var actualValue = vl.value();
                    if (actualValue) {
                        var rf = linter.isValid(this._def,this.parent(),actualValue,vl.property());
                        return rf;
                    }
                }
                return null;
            }
        }
        return c;
    }

    isElement() {
        return false;
    }

    property():defs.Property {
        return <defs.Property>this._prop;
    }

    convertMultivalueToString(value: string): string {
        //|\n  xxx\n  yyy\n  zzz
        var gap = 0;
        var pos = 2;
        while(value[pos] == ' ') {
            gap++;
            pos++;
        }
        //console.log('gap: ' + gap);
        var lines = textutil.splitOnLines(value);
        lines = lines.map(line=> {
            //console.log('line: ' + line);
            return line.substring(gap, line.length);
        });
        return lines.join('');
    }
    _value: string

    overrideValue(value:string){
        this._value = value;
    }

    private _sval:StructuredValue;
    value():any {
        if (this._value){
            return this._value
        }
        this._value=this.calcValue();
        return this._value;
    }
    private calcValue():any{
        if (this._computed){
            return this.computedValue(this.property().nameId());
        }
        if (this.fromKey) {
            return this._node.key();
        }
        if (this.property().isAnnotation()&&this._node.key()&&this._node.key()!='annotations'){
            return new StructuredValue(<ll.ILowLevelASTNode>this._node,this.parent(),this._prop);
        }

        var isString = this.property()!=null && universeHelpers.isStringTypeType(this.property().range());

        var actualValue = this._node.value(isString); //TODO FIXME
        if (this.property().isSelfNode()){
            if (!actualValue||actualValue instanceof jsyaml.ASTNode){
                actualValue=this._node;
                if (actualValue.children().length==0){
                    actualValue=null;
                }
            }
        }
        if (actualValue instanceof jsyaml.ASTNode||actualValue instanceof proxy.LowLevelProxyNode) {
            var isAnnotatedScalar=false;
            if (!this.property().range().hasStructure()){
                if (this._node.isAnnotatedScalar()){
                    this._node.children().forEach(x=>{
                        if (x.key()==="value"){
                            actualValue=x.value(isString);
                            isAnnotatedScalar=true;
                        }
                    })
                }
            }
            if (!isAnnotatedScalar) {
                if (this._sval){
                    return this._sval;
                }
                this._sval= new StructuredValue(<ll.ILowLevelASTNode>actualValue, this.parent(), this._prop);
                return this._sval;
            }
        }
        if(typeof(actualValue)=='string'&&textutil.isMultiLineValue(actualValue)) {
            var res = this.convertMultivalueToString(actualValue);
            //console.log('converted: [' + textutil.replaceNewlines(res) + ']');
            return res;
        }
        return actualValue;
    }

    name() {
        return this._prop.nameId();
    }

    printDetails(indent?:string) : string {
        var className = this.definition().nameId()
        var definitionClassName = this.property().range().nameId()

        var result = (indent?indent:"") +
            (this.name() + " : " + className
            + "[" + definitionClassName + "]"
            + "  =  " + this.value()) + (this.property().isKey()&&this.optional()?"?":"")
            + "\n";

        if (this.value() instanceof StructuredValue){
            var structuredHighLevel : any = (<StructuredValue>this.value()).toHighLevel();
            if (structuredHighLevel && structuredHighLevel.printDetails) {
                result += structuredHighLevel.printDetails(indent + "\t");
            }
        }

        return result;
    }

    /**
     * Used for test comparison of two trees. Touching this will require AST tests update.
     * @param indent
     * @returns {string}
     */
    testSerialize(indent?:string) : string {
        var className = this.definition().nameId()

        var result = (indent?indent:"") +
            (this.name() + " : " + className
            + "  =  " + this.value()) +
            "\n";

        if (this.value() instanceof StructuredValue){
            var structuredHighLevel : any = (<StructuredValue>this.value()).toHighLevel();
            if (structuredHighLevel && structuredHighLevel.testSerialize) {
                result += structuredHighLevel.testSerialize((indent?indent:"") + "  ");
            } else {
                var lowLevel = (<StructuredValue>this.value()).lowLevel();

                var dumpObject = lowLevel.dumpToObject();
                var dump = JSON.stringify(dumpObject)
                var indentedDump = "";
                var dumpLines = dump.split("\n")
                dumpLines.forEach(dumpLine=>indentedDump+=((indent?indent:"") + "  " + dumpLine + "\n"))

                result += indentedDump + "\n";
            }
        }

        return result;
    }

    isAttr():boolean {
        return true;
    }

    isUnknown():boolean {
        return false;
    }

    setValue(value: string|StructuredValue) {
        mutators.setValue(this,value);
        this._value=null;
    }
    setKey(value: string) {
        mutators.setKey(this,value);
        this._value=null;
    }

    children():hl.IParseResult[] {
        return [];
    }


    addStringValue(value: string) {
        mutators.addStringValue(this,value);
        this._value=null;
    }
    
    addStructuredValue(sv: StructuredValue) {
        mutators.addStructuredValue(this,sv)
        this._value=null;
    }

    addValue(value: string|StructuredValue) {
        if(!this.property().isMultiValue()) throw new Error("setValue(string) only apply to multi-values properties");
        if(typeof value == 'string') {
            this.addStringValue(<string>value);
        } else {
            this.addStructuredValue(<StructuredValue>value);
        }
        this._value=null;

    }

    isEmbedded(): boolean {
        var keyname = (<jsyaml.ASTNode>this.lowLevel()).asMapping().key.value;
        //console.log('propery: ' + this.property().name());
        //console.log('mapping: ' + keyname);
        return this.property().canBeValue() && keyname != this.property().nameId();
    }

    remove() {
        mutators.removeAttr(this)
    }

    setValues(values: string[]) {
        mutators.setValues(this,values);
        this._value=null;

    }

    isEmpty(): boolean {
        if(!this.property().isMultiValue()) throw new Error("isEmpty() only apply to multi-values attributes");
        //console.log('remove: ' + this.name());
        var node = this.parent();
        var llnode = <jsyaml.ASTNode>node.lowLevel();
        //node.lowLevel().show('Parent:');
        var attrs = node.attributes(this.name());
        //console.log('attributes: ' + attrs.length);
        if(attrs.length == 0) {
            return true;
        } else if(attrs.length == 1) {
            var anode = <jsyaml.ASTNode>attrs[0].lowLevel();
            //console.log('attribute : ' + anode.kindName());
            //anode.show("ATTR:");
            if(anode.isMapping() && anode.value() == null) {
                // that's crazy but it means zero length array indeed )
                return true;
            } else {
                return false;
            }
        } else {
            return false;
        }
    }

}

var nodeBuilder=new builder.BasicNodeBuilder()

export enum OverlayMergeMode {
    MERGE,
    AGGREGATE
}
export interface ParseNode {

    key():string

    value():any

    children():ParseNode[];

    childWithKey(k:string):ParseNode;

    kind(): number


}


export class LowLevelWrapperForTypeSystem extends defs.SourceProvider implements ParseNode{

    private _toMerge:LowLevelWrapperForTypeSystem;

    constructor(protected _node:ll.ILowLevelASTNode, protected _highLevelRoot:hl.IHighLevelNode){
        super()

        var v=<ASTNodeImpl>_highLevelRoot.root();
        var mst=v.getMaster();
        if (mst&&this._node===_highLevelRoot.lowLevel()){
            var master=(<ASTNodeImpl>_highLevelRoot).getMasterCounterPart();
            if (master){
                this._toMerge=new LowLevelWrapperForTypeSystem(master.lowLevel(),master);
            }
        }
    }

    contentProvider() {
        var root = this._node && this._node.includeBaseUnit() && ((this._node.includePath && this._node.includePath()) ? this._node.includeBaseUnit().resolve(this._node.includePath()) : this._node.includeBaseUnit());

        return new contentprovider.ContentProvider(root);
    }
    
    key(){
        var vl=this._node.key();
        if (this._node.optional()){
            vl=vl+"?";
        }
        return vl;
    }
    value(){
        var vk=this._node.valueKind();
        if (vk===yaml.Kind.SEQ){
            return this.children().map(x=>x.value());
        }
        else if (vk===yaml.Kind.MAP||vk===yaml.Kind.ANCHOR_REF){
            var vl= this._node.dumpToObject(false);
            return vl[this.key()];
        }
        else if (this._node.kind()==yaml.Kind.MAP){
            var vl= this._node.dumpToObject(false);
            return vl;
        }

        if (vk===yaml.Kind.INCLUDE_REF){
            var resolved:ll.ICompilationUnit=null;
            var includePath = this._node.includePath();
            try {
                resolved = this._node.unit().resolve(includePath)
            } catch (e) {}
            if (resolved!=null&&resolved.isRAMLUnit()){
                var includedAST = resolved.ast();
                if(includedAST.kind()==yaml.Kind.SEQ){
                     return new LowLevelWrapperForTypeSystem(includedAST,resolved.highLevel().asElement()).children().map(x=>x.value());
                }
            }
        }
        return this._node.value();
    }
    _children:LowLevelWrapperForTypeSystem[];


    childByKey:{
        [key:string]:LowLevelWrapperForTypeSystem;
    };
    children(){
        if (this._children){
            return this._children;
        }
        if (this.key()=="uses"&&!this._node.parent().parent()){
            this._children= this._node.children().map(x=>new UsesNodeWrapperFoTypeSystem(x,this._highLevelRoot))
        }
        else{
            this._children=this._node.children().map(x=>new LowLevelWrapperForTypeSystem(x,this._highLevelRoot));
        }
        this.childByKey={};
        for (var i=0;i<this._children.length;i++){
            var c=this._children[i];
            this.childByKey[c.key()]=c;
        }
        if (this._toMerge){
            var mrg=this._toMerge.children();
            for (var i=0;i<mrg.length;i++){
                var c=mrg[i];
                var existing=this.childByKey[c.key()];
                if (existing){
                    existing._toMerge=c;
                }
                else{
                    this._children.push(c);
                    this.childByKey[c.key()]=c;
                }

            }
        }
        return this._children;
    }
    childWithKey(k:string):ParseNode
    {
        if (!this._children){
            this.children();
        }
        return this.childByKey[k];
    }
    kind(){
        var vk=this._node.valueKind();
        if (vk==yaml.Kind.MAPPING||vk===null){
            return rTypes.NodeKind.MAP;
        }
        if (vk==yaml.Kind.MAP){
            return rTypes.NodeKind.MAP;
        }
        var knd=this._node.kind();
        if (knd==yaml.Kind.MAP){
            return rTypes.NodeKind.MAP;
        }
        if (vk==yaml.Kind.SEQ){
            return rTypes.NodeKind.ARRAY;
        }
        if (vk==yaml.Kind.INCLUDE_REF){
            if (this._node.children().length>0){
                //we can safely assume that it is map in the type system in this case
                return rTypes.NodeKind.MAP;
            }
        }
        return rTypes.NodeKind.SCALAR;
    }

    getSource() : any {
        if (!this._node) return null;
        var highLevelNode = this._node.highLevelNode();
        if (!highLevelNode) {
            var position = this._node.start()
            var result = search.deepFindNode(this._highLevelRoot, position, position, true, false);

            if (result) {
                this._node.setHighLevelParseResult(result);
                if (result instanceof ASTNodeImpl) {
                    this._node.setHighLevelNode(<ASTNodeImpl>result)
                }
            }

            return result;
        }
    }
}
export class UsesNodeWrapperFoTypeSystem extends LowLevelWrapperForTypeSystem{
    children(){
        var s=this._node.unit().resolve(this.value());
        if (s&&s.isRAMLUnit()){
            return new LowLevelWrapperForTypeSystem(s.ast(), this._highLevelRoot).children();
        }
        return [];
    }

    anchor(){
        return this._node.actual();
    }
    childWithKey(k:string):ParseNode
    {

        var mm=this.children();
        for (var i=0;i<mm.length;i++){
            if (mm[i].key()==k){
                return mm[i];
            }
        }
        return null;
    }
}
export class ASTNodeImpl extends BasicASTNode implements  hl.IEditableHighLevelNode{


    private _types:rTypes.IParsedTypeCollection;
    private _ptype:rTypes.IParsedType;


    validate(v:hl.ValidationAcceptor):void{
        var k=this.definition().key();
        if (k==universes.Universe10.Api||k==universes.Universe08.Api||k==universes.Universe10.Extension){
            if (!this.isExpanded()){
                var nm=expander.expandTraitsAndResourceTypes(<any>this.wrapperNode());
                var hlnode=nm.highLevel();
                hlnode.resetChildren();
                hlnode.children();
                hlnode._expanded=true;
                (<ASTNodeImpl>hlnode).clearTypesCache();
                hlnode.validate(v);
                return;
            }
        }
        if (k==universes.Universe10.Overlay||k==universes.Universe10.Extension){
            this.clearTypesCache();
        }
        linter.validate(this,v);
    }
    clearTypesCache(){
        this._types=null;
        var c=this.lowLevel().actual();
        c.types=null;
    }

    types():rTypes.IParsedTypeCollection{
        if (!this._types){
            if (this.parent()&&(this.definition().key()!==universes.Universe10.Library)){
                return this.parent().types();
            }
            else{
                var c=this.lowLevel().actual();
                if (c.types){
                    return c.types;
                }
                this._types = rTypes.parseFromAST(new LowLevelWrapperForTypeSystem(this.lowLevel(), this));
                this._types.types().forEach(x=>{
                    var convertedType = typeBuilder.convertType(this,x)
                    // if (defs.instanceOfHasExtra(convertedType)) {
                        convertedType.putExtra(defs.USER_DEFINED_EXTRA, true);
                    // }
                });
                c.types=this._types;
            }

        }
        return this._types;
    }

    setTypes(t:rTypes.IParsedTypeCollection){
        this._types=t;
    }

    parsedType():rTypes.IParsedType{

        if (!this._ptype){
            if (this.property()&&this.property().nameId()==universes.Universe10.MethodBase.properties.body.name){
                this._ptype = rTypes.parseTypeFromAST(this.name(), new LowLevelWrapperForTypeSystem(this.lowLevel(), this), this.types(),true,false,false);
            }
            else {
                var annotation=this.property()&&this.property().nameId()==universes.Universe10.LibraryBase.properties.annotationTypes.name;
                var tl=(!this.property())||(this.property().nameId()==universes.Universe10.LibraryBase.properties.types.name||this.property().nameId()==universes.Universe10.LibraryBase.properties.schemas.name);
                this._ptype = rTypes.parseTypeFromAST(this.name(), new LowLevelWrapperForTypeSystem(this.lowLevel(), this), this.types(),false,annotation,tl);
            }

            if (this.property() && universeHelpers.isTypesProperty(this.property())
                && this.parent() && universeHelpers.isApiType(this.parent().definition())) {
                //top level types declared via "types"
                // this._ptype.setExtra()
                if ((<any>this._ptype).putExtra) {
                    (<any>this._ptype).putExtra(defs.DEFINED_IN_TYPES_EXTRA, true);
                }
            }
            var potentialHasExtra = this._ptype;

            potentialHasExtra.putExtra(defs.USER_DEFINED_EXTRA, true);
            this._ptype.putExtra(defs.SOURCE_EXTRA, this);
        }



        return this._ptype;
    }
    localType():hl.ITypeDefinition{
        return typeBuilder.typeFromNode(this);
    }

    private _expanded=false;
    _children:hl.IParseResult[];
    _allowQuestion:boolean=false;
    _associatedDef:hl.INodeDefinition;
    _subTypesCache:{ [name:string]:hl.ITypeDefinition[]}=null;
    private _wrapperNode:ParserCore.BasicNode;
    private _isAux:boolean
    private _auxChecked:boolean=false;
    private _knownIds:{[name:string]:hl.IParseResult};
    private _knownLowLevelIds:{[name:string]:ll.ILowLevelASTNode};

    isInEdit:boolean;

    /**
     * Externally set master AST, should be only available for root nodes,
     * and only in the case when we merge multiple overlays/extensions.
     */
    private masterApi : hl.IParseResult;

    /**
     * Depending on the merge mode, overlays and extensions are either merged with the master, or their trees are joined via aggregation
     * @type {OverlayMergeMode}
     */
    private overlayMergeMode : OverlayMergeMode = OverlayMergeMode.MERGE;


    constructor(node:ll.ILowLevelASTNode, parent:hl.IHighLevelNode,private _def:hl.INodeDefinition,private _prop:hl.IProperty){
        super(node,parent)
        if(node) {
            node.setHighLevelNode(this);
        }
        if (node instanceof proxy.LowLevelProxyNode){
            this._expanded=true;
        }
    }
    
    _computedKey:string;


    patchProp(pr:hl.IProperty){
        this._prop=pr;
    }


    getKind() : hl.NodeKind {
        return hl.NodeKind.NODE
    }

    wrapperNode():ParserCore.BasicNode{
        if(!this._wrapperNode){
            //forcing discrimination
            this.children();

            this._wrapperNode = this.buildWrapperNode();
        }
        return this._wrapperNode;
    }
    asElement():hl.IHighLevelNode{
        return this;
    }
    private buildWrapperNode(){
        var ramlVersion = this.definition().universe().version();
        if(ramlVersion=='RAML10'){
            return factory10.buildWrapperNode(this);
        }
        else if(ramlVersion=='RAML08'){
            return factory08.buildWrapperNode(this);
        }
        return null;
    }

    propertiesAllowedToUse():hl.IProperty[]{
        return this.definition().allProperties().filter(x=>this.isAllowedToUse(x));
    }

    isAllowedToUse(p:hl.IProperty){
        var ok=true;
        if (p.getAdapter(services.RAMLPropertyService).isSystem()){
            return false;
        }
        (<def.Property>p).getContextRequirements().forEach(y=>{
            if (y.name.indexOf('(')!=-1){
                //TODO HANDLE IT LATER
                return true;
            }
            var vl=this.computedValue(y.name);

            if (vl){
                ok=ok&&(vl==y.value);
            }
            else{
                if (y.value){
                    ok=false;
                }
            }
        })
        return ok;
    }

    allowRecursive(){
        if (this.definition().getAdapter(services.RAMLService).isUserDefined()){
            return true;
        }
        return false;
    }
    setWrapperNode(node:ParserCore.BasicNode){
        this._wrapperNode = node;
    }

    setAssociatedType(d:hl.INodeDefinition){
        this._associatedDef=d;
    }

    associatedType():hl.INodeDefinition{
        return this._associatedDef;
    }

    knownIds(){
        //initializing ids if needed
        //TODO refactor workaround
        this.isAuxilary();

        if(this._knownIds) {
            return this._knownIds;
        } else {
            return {};
        }
    }

    findById(id:string){

        var v=this._knownIds;
        if (!v){
            this._knownIds={};
            var all=search.allChildren(<hl.IHighLevelNode>this);
            all.forEach(x=>this._knownIds[x.id()]=x);
        }
        return this._knownIds[id];
    }

    isAuxilary(){
        if(this._isAux){
            return true;
        }
        if (this._auxChecked){
            return false;
        }
        this._auxChecked=true;

        var masterApi = this.getMaster();

        if (masterApi){

            this._isAux=true;

            this.initilizeKnownIDs(masterApi)

            return true
        }
        return false;
    }

    private initilizeKnownIDs(api : hl.IParseResult) : void {
        this._knownIds={};

        var allChildren = search.allChildren(<hl.IHighLevelNode>api);

        allChildren.forEach(x=>this._knownIds[x.id()]=x);

        this._knownIds[""]=api;
    }

    getMaster() : hl.IParseResult {
        if (this.masterApi) {
            return this.masterApi;
        }

        return this.calculateMasterByRef();
    }

    /**
     * Forcefully sets a master unit for this API, which may be different from the one, current unit points to
     * via masterRef.
     * @param master
     */
    overrideMaster(master : hl.IParseResult) : void {
        this.masterApi = master;

        this.resetAuxilaryState();
    }

    setMergeMode(mergeMode : OverlayMergeMode) : void {
        this.overlayMergeMode = mergeMode;
        this.resetAuxilaryState();
    }

    getMergeMode() {
        return this.overlayMergeMode;
    }




    private calculateMasterByRef() : hl.IParseResult {

        var unit = this.lowLevel().unit();
        if (!unit) return null;

        var masterReferenceNode = unit.getMasterReferenceNode();

        if (!masterReferenceNode || !masterReferenceNode.value()) {
            return null;
        }
        var lc:any=this.lowLevel();
        if (lc.master){
            return lc.master;
        }
        var masterPath = masterReferenceNode.value();

        var masterUnit = (<jsyaml.Project>this.lowLevel().unit().project()).resolve(this.lowLevel().unit().path(),masterPath);
        if (!masterUnit) {
            return null;
        }
        var result = masterUnit.expandedHighLevel();
        (<ASTNodeImpl>result).setMergeMode(this.overlayMergeMode);
        lc.master=result;
        return result;
    }


    private resetAuxilaryState() {
        this._isAux = false;
        this._auxChecked = false;
        this._knownIds = null;
        this.clearChildrenCache();
    }

    printDetails(indent?:string) : string {
        var result : string = ""
        if (!indent) indent = ""
        var classname = this.definition().nameId()
        var definitionClasName = this.property() ? this.property().range().nameId() : ""
        var parentPropertyName = this.property() ? this.property().nameId() : "";
        result += indent + classname + "[" + definitionClasName + "]" + " <--- " +parentPropertyName + "\n"
        this.children().forEach(child=>{
            result += child.printDetails(indent + "\t")
        })
        return result
    }

    /**
     * Used for test comparison of two trees. Touching this will require AST tests update.
     * @param indent
     * @returns {string}
     */
    testSerialize(indent?:string) : string {
        var result : string = ""
        if (!indent) indent = ""
        var classname = this.definition().nameId()
        var parentPropertyName = this.property() ? this.property().nameId() : "";
        result += indent + classname + " <-- " +parentPropertyName + "\n"
        this.children().forEach(child=>{
            if ((<any>child).testSerialize) {
                result += (<any>child).testSerialize(indent + "  ")
            }
        })
        return result
    }

    private getExtractedChildren(){
        var r=<ASTNodeImpl>this.root();
        if (r.isAuxilary()){
            if (r._knownIds){
                var i=<hl.IHighLevelNode>r._knownIds[this.id()];
                if (i){
                    var v=i.children();
                    return v;
                }
            }
            return [];
        }
        return [];
    }
    getMasterCounterPart():hl.IHighLevelNode{
        var r=<ASTNodeImpl>this.root();
        if (r.isAuxilary()){
            if (r._knownIds){
                var i=<hl.IHighLevelNode>r._knownIds[this.id()];
                return i;
            }
            return null;
        }
        return null;
    }

    private getExtractedLowLevelChildren(n:ll.ILowLevelASTNode){
        var r=<ASTNodeImpl>this.root();
        if (r.isAuxilary()){
            if (r._knownLowLevelIds){
                var i=<ll.ILowLevelASTNode>r._knownLowLevelIds[this.id()];
                if (i){
                    return i.children();
                }
            }
            return [];
        }
        return [];
    }

    allowsQuestion():boolean{
        return this._allowQuestion||this.definition().getAdapter(services.RAMLService).getAllowQuestion();
    }

    findReferences():hl.IParseResult []{
        var rs:hl.IParseResult[]=[];
        search.refFinder(this.root(),this,rs);
        //TODO FIX ME
        if (rs.length>1) {
           rs=rs.filter(x=>x!=this&& x.parent()!=this);
        }
        //filtering out equal results
        var filteredReferences:hl.IParseResult[]=[];
        rs.forEach(ref => {
            if (!_.find(filteredReferences, existing=>existing==ref)) {
                filteredReferences.push(ref);
            }
        });
        return filteredReferences;
    }
    private  _patchedName:string;

    setNamePatch(s: string){
        this._patchedName=s;
    }
    isNamePatch(){
        return this._patchedName;
    }

    name(){
        if (this._patchedName){
            return this._patchedName
        }
        var ka=_.find(this.directChildren(),x=>x.property()&&x.property().getAdapter(services.RAMLPropertyService).isKey());
        if (ka&&ka instanceof ASTPropImpl){
            var c= (<ASTPropImpl>ka).value();
            return c;
        }
        return super.name();
    }

    findElementAtOffset(n:number):hl.IHighLevelNode{
        return this._findNode(this,n,n);
    }

    isElement(){
        return true;
    }

    private _universe:defs.Universe;
    universe():defs.Universe{
        if (this._universe){
            return this._universe;
        }
        return <any>this.definition().universe()
    }
    setUniverse(u:defs.Universe){
        this._universe=u;
    }

    private _findNode(n:hl.IHighLevelNode,offset:number,end:number):hl.IHighLevelNode{
        if (n==null){
            return null;
        }
        if (n.lowLevel()) {
            //var node:ASTNode=<ASTNode>n;
            if (n.lowLevel().start() <= offset && n.lowLevel().end() >= end) {
                var res:hl.IHighLevelNode = n;
                //TODO INCLUDES
                n.elements().forEach(x=> {
                    if (x.lowLevel().unit()!=n.lowLevel().unit()){
                        return;
                    }
                    var m = this._findNode(x, offset, end);
                    if (m) {
                        res = m;
                    }
                })
                return res;
            }
        }
        return null;
    }


    isStub(){
        return (!this.lowLevel().unit())||(<jsyaml.CompilationUnit>this.lowLevel().unit()).isStubUnit();
    }

    add(node: hl.IHighLevelNode|hl.IAttribute){
        mutators.addToNode(this,node)
    }

    remove(node:hl.IHighLevelNode|hl.IAttribute){
        mutators.removeNodeFrom(this,node);
    }

    dump(flavor:string):string{
        return this._node.dump()
    }

    patchType(d:hl.INodeDefinition){
        this._def=d;
        var ass=this._associatedDef;
        this._associatedDef=null;
        this._children=null;
        this._mergedChildren=null;
    }
    _mergedChildren:hl.IParseResult[];

    children():hl.IParseResult[] {

        var lowLevel = this.lowLevel();

        if(lowLevel && (<any>lowLevel).isValueInclude && (<any>lowLevel).isValueInclude() && resourceRegistry.isWaitingFor((<any>lowLevel).includePath())) {
            this._children = null;

            return [];
        }

        if (this._children){
            if (this._mergedChildren){
                return this._mergedChildren;
            }
            this._mergedChildren= this.mergeChildren(this._children, this.getExtractedChildren());
            return this._mergedChildren;
        }

        if (this._node) {
            this._children = nodeBuilder.process(this, this._node.children());
            this._children=this._children.filter(x=>x!=null);
            //FIXME

            return this.mergeChildren(this._children, this.getExtractedChildren());
        }
        return [];
    }


    private mergeChildren(originalChildren : hl.IParseResult[],
                          masterChildren : hl.IParseResult[]) : hl.IParseResult[] {

        var root = <ASTNodeImpl>this.root();

        if (root.overlayMergeMode == OverlayMergeMode.AGGREGATE) {

            //simply joining the sets
            return originalChildren.concat(masterChildren);
        }
        else if (root.overlayMergeMode  == OverlayMergeMode.MERGE) {

            var result : hl.IParseResult[] = []

            originalChildren.forEach(originalChild => {

                var masterCounterpart = _.find(masterChildren,
                        masterChild => masterChild.fullLocalId() == originalChild.fullLocalId());

                if (!masterCounterpart) {
                    //we dont have a counterpart, so simply adding to result
                    result.push(originalChild);
                } else {

                    //there is a counterpart, so deciding what to do:
                    this.mergeChild(result, originalChild, masterCounterpart);
                }
            })

            masterChildren.forEach(masterChild => {

                var originalCounterpart = _.find(originalChildren,
                        originalChild => masterChild.fullLocalId() == originalChild.fullLocalId());

                if (!originalCounterpart) {
                    //we dont have a counterpart, so simply adding to result
                    result.push(masterChild);
                }
            })

            return result;
        }

        return null;
    }
    private mergeLowLevelChildren(originalChildren : ll.ILowLevelASTNode[],
                          masterChildren : ll.ILowLevelASTNode[]) : ll.ILowLevelASTNode[] {

        var root = <ASTNodeImpl>this.root();

        if (root.overlayMergeMode == OverlayMergeMode.AGGREGATE) {

            //simply joining the sets
            return originalChildren.concat(masterChildren);
        }
        else if (root.overlayMergeMode  == OverlayMergeMode.MERGE) {

            var result : ll.ILowLevelASTNode[] = []

            originalChildren.forEach(originalChild => {

                var masterCounterpart = _.find(masterChildren,
                    masterChild => masterChild.key() == originalChild.key());

                if (!masterCounterpart) {
                    //we dont have a counterpart, so simply adding to result
                    result.push(originalChild);
                } else {

                    //there is a counterpart, so deciding what to do:
                    this.mergeLowLevelChild(result, originalChild, masterCounterpart);
                }
            })

            masterChildren.forEach(masterChild => {

                var originalCounterpart = _.find(originalChildren,
                    originalChild => masterChild.key() == originalChild.key());

                if (!originalCounterpart) {
                    //we dont have a counterpart, so simply adding to result
                    result.push(masterChild);
                }
            })

            return result;
        }

        return null;
    }
    private mergeLowLevelChild(result : ll.ILowLevelASTNode[], originalChild : ll.ILowLevelASTNode,
                       masterChild : ll.ILowLevelASTNode) {

        if (originalChild.kind() != masterChild.kind()) {

            //should not happen theoretically
            result.push(originalChild);
            result.push(masterChild);
            return;
        }
        result.push(originalChild);
    }

    private mergeChild(result : hl.IParseResult[], originalChild : hl.IParseResult,
        masterChild : hl.IParseResult) {

        if (originalChild.getKind() != masterChild.getKind()) {

            //should not happen theoretically
            result.push(originalChild);
            result.push(masterChild);
            return;
        }

        if (originalChild.getKind() == hl.NodeKind.NODE) {

            result.push(originalChild);
            return;
        } else if (originalChild.getKind() == hl.NodeKind.ATTRIBUTE) {

            //if ((<ASTPropImpl>originalChild).name() == "displayName" ||
            //    (<ASTPropImpl>originalChild).name() == "title") {
            //    console.log("OriginalChildForDisplayName: " + (<ASTPropImpl>originalChild).value())
            //    console.log("MasterChildForDisplayName: " + (<ASTPropImpl>masterChild).value())
            //
            //}

            result.push(originalChild);
            return;
        } else if (originalChild.getKind() == hl.NodeKind.BASIC) {

            //we do not know what to do with basic nodes, so adding both.
            result.push(originalChild);
            result.push(masterChild);
            return;
        }
    }

    directChildren():hl.IParseResult[] {
        if (this._children){
            return this._children;
        }
        if (this._node) {
            this._children = nodeBuilder.process(this, this._node.children());
            return this._children;

        }
        return [];
    }

    resetChildren(){
        this._children = null;
        this._mergedChildren=null;
    }

    isEmptyRamlFile(): boolean {
        var llroot = <jsyaml.ASTNode>(<jsyaml.ASTNode>this.lowLevel()).root();
        return llroot.isScalar();
    }

    initRamlFile() {
        mutators.initEmptyRAMLFile(this);
    }

    createAttr(n:string,v:string){
        mutators.createAttr(this,n,v);
    }


    isAttr():boolean{
        return false;
    }
    isUnknown():boolean{
        return false;
    }
    value():any{
        return this._node.value();
    }

    valuesOf(propName:string):hl.IHighLevelNode[]{
        var pr= this._def.property(propName)
        if (pr!=null){
            return this.elements().filter(x=>x.property()==pr);
        }
        return [];
    }
    attr(n:string):hl.IAttribute{
        return _.find(this.attrs(),y=>y.name()==n);
    }

    attrOrCreate(name: string):hl.IAttribute{
        var a = this.attr(name);
        if(!a) this.createAttr(name, '');
        return this.attr(name);
    }

    attrValue(n:string):string {
        var a = this.attr(n);
        return a? a.value() : null;
    }

    attributes(n:string):hl.IAttribute[]{
        return _.filter(this.attrs(),y=>y.name()==n);
    }

    attrs():hl.IAttribute[]{
        var rs= <hl.IAttribute[]>this.children().filter(x=>x.isAttr());
        if (this._patchedName){
            var kp=_.find(this.definition().allProperties(),x=>x.getAdapter(services.RAMLPropertyService).isKey());
            if (kp) {
                var mm = new ASTPropImpl(this.lowLevel(), this, kp.range(), kp, true);
                mm._value = this._patchedName;
                return (<hl.IAttribute[]>[mm]).concat(rs);
            }
        }
        return rs;
    }

    elements():hl.IHighLevelNode[]{
        return <hl.IHighLevelNode[]>this.children()
            .filter(x=>!x.isAttr()&&!x.isUnknown())
    }
    element(n:string):hl.IHighLevelNode{
        var r= this.elementsOfKind(n)
        if (r.length>0){
            return r[0];
        }
        return null;
    }

    elementsOfKind(n:string):hl.IHighLevelNode[]{
        var r= this.elements().filter(x=>x.property().nameId()==n)
        return r;
    }

    definition():hl.INodeDefinition {
        return this._def;
    }

    property():hl.IProperty {
        return this._prop;
    }

    isExpanded():boolean {
        return this._expanded;
    }

    copy(): ASTNodeImpl {
        return new ASTNodeImpl(this.lowLevel().copy(), this.parent(), this.definition(), this.property());
    }

    clearChildrenCache() {
        this._children = null;
        this._mergedChildren=null;
    }

    optionalProperties():string[]{
        var def = this.definition();
        if(def==null){
            return [];
        }
        var result:string[] = [];
        var map = {};
        var children = this.lowLevel().children();
        children.forEach(x=>{
            if(x.optional()){
                map[x.key()] = true;
            }
        });
        var props = def.allProperties();
        props.forEach(x=>{
            var prop:def.Property = <def.Property>x;
            if(map[prop.nameId()]){
                result.push(prop.nameId());
            }
        });
        return result;
    }
}

export var universeProvider = require("./definition-system/universeProvider");
var getDefinitionSystemType = function (contents:string,ast:ll.ILowLevelASTNode) {


    var spec = "";
    var ptype = "Api";
    var originalPType = null;
    var num = 0;
    var pt = 0;

    for (var n = 0; n < contents.length; n++) {
        var c = contents.charAt(n);
        if (c == '\r' || c == '\n') {
            if (spec) {
                ptype = contents.substring(pt, n).trim();
                originalPType = ptype;
            }
            else {
                spec = contents.substring(0, n).trim();
            }
            break;
        }
        if (c == ' ') {
            num++;
            if (!spec && num == 2) {
                spec = contents.substring(0, n);
                pt = n;
            }
        }
    }
    var localUniverse = spec == "#%RAML 1.0" ? new def.Universe(null,"RAML10", universeProvider("RAML10"),"RAML10") : new def.Universe(null,"RAML08", universeProvider("RAML08"));

    if (ptype=='API'){
        ptype="Api"
    }
    else if (ptype=='NamedExample'){
        ptype="ExampleSpec"
    }
    else if (ptype=='DataType'){
        ptype="TypeDeclaration"
    }
    else if (ptype=='SecurityScheme'){
        ptype="AbstractSecurityScheme"
    }
    else if (ptype=='AnnotationTypeDeclaration'){
        ptype="TypeDeclaration"
    }


    localUniverse.setOriginalTopLevelText(originalPType);
    localUniverse.setTopLevel(ptype);
    localUniverse.setTypedVersion(spec);

    // localUniverse.setDescription(spec);
    return { ptype: ptype, localUniverse: localUniverse };
};

export function getFragmentDefenitionName(highLevelNode: hl.IHighLevelNode): string {
    var contents = highLevelNode.lowLevel() && highLevelNode.lowLevel().unit() && highLevelNode.lowLevel().unit().contents();

    if (contents == null) {
        return null;
    }

    return getDefinitionSystemType(contents, highLevelNode.lowLevel()).ptype;
}

export function fromUnit(l: ll.ICompilationUnit): hl.IParseResult {
    if (l == null)
        return null;

    var contents = l.contents();
    var ast = l.ast();
    var __ret = getDefinitionSystemType(contents, ast);
    var ptype = __ret.ptype;
    var localUniverse = __ret.localUniverse;
    var apiType = localUniverse.type(ptype)

    if (!apiType) apiType = localUniverse.type("Api");

    var api = new ASTNodeImpl(ast, null, <any>apiType, null);
    api.setUniverse(localUniverse);
    //forcing discrimination
    api.children();
    return api;
}
