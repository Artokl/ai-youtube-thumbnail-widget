class AIThumbnailGenerator extends HTMLElement {
  connectedCallback() {

    const iframe = document.createElement("iframe")

    iframe.src = "https://ai-youtube-thumbnail-widget.vercel.app"

    iframe.style.width = "100%"
    iframe.style.height = "650px"
    iframe.style.border = "none"
    iframe.style.display = "block"

    iframe.loading = "lazy"

    iframe.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-forms allow-popups"
    )

    this.appendChild(iframe)
  }
}

customElements.define("ai-thumbnail-generator", AIThumbnailGenerator)