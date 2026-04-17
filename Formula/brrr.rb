class Brrr < Formula
  desc "Webhook notifications for Claude Code and Codex"
  homepage "https://github.com/simonbs/brrr-cli"
  url "https://github.com/simonbs/brrr-cli/archive/refs/tags/v0.2.0.tar.gz"
  sha256 "c411e9c0d4f1c094c1d04df89d235399e2fe4f12730c171b10d3d725a48c7c4d"
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
