class Brrr < Formula
  desc "Webhook notifications for Claude Code and Codex"
  homepage "https://github.com/simonbs/brrr-cli"
  url "https://github.com/simonbs/brrr-cli/archive/refs/tags/v0.1.1.tar.gz"
  sha256 "65c44f7462b78272d69d4955f5c6b8b819b7dd243fabffad1eed6b55328d9793"
  head "https://github.com/simonbs/brrr-cli.git", branch: "main"

  depends_on "node"

  def install
    system "npm", "ci"
    system "npm", "run", "build"
    system "npm", "prune", "--omit=dev"

    libexec.install Dir["*"]
    bin.install_symlink libexec/"dist/src/cli.js" => "brrr"
  end

  test do
    assert_match "Usage: brrr", shell_output("#{bin}/brrr --help")
  end
end
