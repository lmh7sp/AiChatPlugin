sap.ui.define([
	"sap/ui/core/Component",
	"sap/base/util/ObjectPath",
	"sap/m/Button",
	"sap/ui/core/Fragment",
	"sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast"

], function (Component, ObjectPath, Button, Fragment, JSONModel, MessageBox,MessageToast) {

	return Component.extend("aichatplugin.Component", {

		metadata: {
			"manifest": "json"
		},

		init: function () {
			var rendererPromise = this._getRenderer();
			var oResourceBundle = this.getModel("i18n").getResourceBundle();
			// This is example code. Please replace with your implementation!

			/**
			 * Add a footer with a button
			 */
			rendererPromise.then(function (oRenderer) {
				var oButton = new Button({
					text: oResourceBundle.getText("buttonText"),
					press: this.onOpenChatPopover.bind(this)
				})
				oRenderer.setFooterControl("sap.m.Bar", {
					id: "myFooter",
					contentRight: [oButton]
				});
			}.bind(this));

		},
		
		onOpenChatPopover: function (oEvent) {
			if (!this._chatPopover) {
				this._chatModel = new JSONModel({
					conversationId:self.crypto.randomUUID(),
					user_id: this._getUserInfo(),// 이 부분에 email이 들어가야함..
					user_query: '',
					isBusy: false,
					enableTextArea: true,
					messages: [] // 초기 채팅 목록
				});
				Fragment.load({
					id: this.getId(),
					name: "aichatplugin.fragments.AiChatBox",
					controller: this
				}).then(function (oPopover) {
					this._chatPopover = oPopover;
					oEvent.getSource().addDependent(oPopover);
					oPopover.attachAfterOpen(() => {
						this._attachEnterHandler();
					});
					oPopover.setModel(this._chatModel,"chatModel");
					oPopover.setModel(this.getModel());
					oPopover.openBy(oEvent.getSource());
				}.bind(this));
			} else if(this._chatPopover.isOpen()){
				this._chatPopover.close();
			} else {
				this._chatPopover.openBy(oEvent.getSource());
			}
		},
		
		_attachEnterHandler: function () {
			const oInput = this.byFragmentId("chatInput");
		  
			const oDomRef = oInput.getDomRef("inner"); // TextArea의 textarea DOM
		  
			if (!oDomRef || this._bEnterHandler) return;
			oDomRef?.addEventListener("keydown", function (oEvent) {
			  if (oEvent.key === "Enter" && !oEvent.shiftKey) {
				oEvent.preventDefault();
				this.onSendMessage(); // 전송
			  }
			}.bind(this));
			this._bEnterHandler = true;
		},
		_getUserInfo:function(){
			const oUserInfoSrv = sap.ushell.Container.getService("UserInfo");
			return oUserInfoSrv.getEmail() || "dummy.user@com";
		},
		onSendMessage: function () {
			const sMessage = this._chatModel.getProperty("/user_query");
			if (!sMessage || !sMessage.trim()) return;

			this._chatModel.setProperty("/user_query", ""); // 입력 초기화

			
			var oModel = this.getModel();
			var sMessageTime = new Date();
			var oActionODataContextBinding = oModel.bindContext("/getChatRagResponse(...)");
			oActionODataContextBinding.setParameter("conversationId", this._chatModel.getProperty("/conversationId"));
			oActionODataContextBinding.setParameter("messageId", self.crypto.randomUUID());
			oActionODataContextBinding.setParameter("message_time", sMessageTime);
			oActionODataContextBinding.setParameter("user_id", this._chatModel.getProperty("/user_id"));
			oActionODataContextBinding.setParameter("user_query", sMessage);
			const bNew = !(this._chatModel.getProperty("/messages")?.length > 0);
			this._addChatMessage( sMessage.trim(),sMessageTime, "user");
			
			this._chatModel.setProperty("/isBusy",true);
			oActionODataContextBinding.execute().then(
				() => {
					this._chatModel.setProperty("/isBusy",false);
					if(bNew){
						this.byFragmentId("historyList").getBinding("items").refresh();
					}
					var oActionContext = oActionODataContextBinding.getBoundContext();
					var oReturnedObject = oActionContext.getObject();
					if(oReturnedObject){
						this._addChatMessage(oReturnedObject.content,new Date(oReturnedObject.messageTime),oReturnedObject.role);
					}
				}
			).catch((oError) => {
				this._chatModel.setProperty("/isBusy",false);
				this._refreshMessages(this._chatModel.getProperty("/conversationId"));
				MessageToast.show(oError.message);
			});
		},
		_addChatMessage: function ( sText, message_time, sType) {
			const aMessages = this._chatModel.getProperty("/messages") || [];
			// this._chatModel.getProperty("/user_id")
			aMessages.push({
				user_id: sType === "user" ? this._chatModel.getProperty("/user_id") : "AI",
				user_query: sText,
				message_time: message_time.toISOString(),
				user_role: sType // 'user' or 'ai'
			});
		  
			this._chatModel.setProperty("/messages", aMessages);
			
			// Scroll 맨 아래로
			setTimeout(function(){
				this.byFragmentId("chatMessageArea")?.scrollTo(0, 9999, 200);
			}.bind(this), 0);
		},
		
		onNewChat:function(){
			this._chatModel.setProperty("/messages",[]);
			this._chatModel.setProperty("/conversationId",self.crypto.randomUUID());
		},
		onDeleteChat:function(oEvent){
			var oDeleteCandidates = this.byFragmentId("historyList").getSelectedContexts();
			MessageBox.warning("This will delete your conversation permanently",{
				actions: ["Remove", MessageBox.Action.CANCEL],
				onClose: (sAction) => {
					if (sAction !== "Remove") return;
					const aDeletePromises = oDeleteCandidates.map((oContext) => {
						return oContext.delete().then(() => {
						   console.log("삭제 성공:", oContext);
						}).catch((oError) => {
						   console.error("삭제 실패:", oError.message);
						   // 실패한 경우에도 계속 진행하려면 catch에서 에러를 먹고 넘어가야 함
						});
					});
					  
					Promise.all(aDeletePromises).then(() => {
						console.log("모든 삭제 작업 완료!");
						this.onNewChat();
						this.byFragmentId("historyList").getBinding("items").refresh();
					});
				}
			});
		},
		onSelectHistory: function (oEvent) {
			const oItem = oEvent.getSource();
			const conversationID = oItem.getBindingContext().getProperty("cID");
			this._refreshMessages(conversationID);
		},
		_refreshMessages:function(conversationID){
			this._chatModel.setProperty("/messages",[]);
			this._chatModel.setProperty("/conversationId",conversationID);
			this._chatModel.setProperty("/isBusy",true);
			
			var oListBinding = this.getModel().bindList(`/Conversation(${conversationID})/to_messages`);

			oListBinding.requestContexts().then((aContexts) => {
				aContexts.map((oContext) => {
					var returnObj = oContext.getObject();
					this._addChatMessage(returnObj.content,new Date(returnObj.creation_time),returnObj.role);
				});
				this._chatModel.setProperty("/isBusy",false);
			}).catch((oError) => {
				this._chatModel.setProperty("/isBusy",false);
				console.log("데이터 조회 실패: " + oError.message);
			});
		},






		byFragmentId:function(sId){
			return Fragment.byId(this.getId(),sId);
		},

		/**
		 * Returns the shell renderer instance in a reliable way,
		 * i.e. independent from the initialization time of the plug-in.
		 * This means that the current renderer is returned immediately, if it
		 * is already created (plug-in is loaded after renderer creation) or it
		 * listens to the &quot;rendererCreated&quot; event (plug-in is loaded
		 * before the renderer is created).
		 *
		 *  @returns {Promise} a Promise which will resolve with the renderer instance, 
		 * 					   or be rejected with an error message.
		 */
		_getRenderer: function () {
			return new Promise(function(fnResolve, fnReject) {
				this._oShellContainer = ObjectPath.get("sap.ushell.Container");
				if (!this._oShellContainer) {
					fnReject(
						"Illegal state: shell container not available; this component must be executed in a unified shell runtime context."
					);
				} else {
					var oRenderer = this._oShellContainer.getRenderer();
					if (oRenderer) {
						fnResolve(oRenderer);
					} else {
						// renderer not initialized yet, listen to rendererCreated event
						this._onRendererCreated = function(oEvent) {
							oRenderer = oEvent.getParameter("renderer");
							if (oRenderer) {
								fnResolve(oRenderer);
							} else {
								fnReject(
									"Illegal state: shell renderer not available after receiving 'rendererLoaded' event."
								);
							}
						};
						this._oShellContainer.attachRendererCreatedEvent(
							this._onRendererCreated
						);
					}
				}
			}.bind(this));
		},

		exit: function () {
		    if (this._oShellContainer && this._onRendererCreated) {
			this._oShellContainer.detachRendererCreatedEvent(this._onRendererCreated);
		    }
		}
	});
});
