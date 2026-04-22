class Brrr < Formula
  desc "Webhook notifications for Claude Code and Codex"
  homepage "https://github.com/simonbs/brrr-cli"
  url "https://github.com/simonbs/brrr-cli/archive/refs/tags/v0.2.3.tar.gz"
  sha256 "0f9bf9aa93d20c9757b4fc1c529320b0534621a928a0706b8ddef6040ffeea12"
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
